// Pure decision logic: daily pick, completion verdict, character SRS,
// assessment scoring, reward rules. No I/O — unit-tested in test/.
import { newCharsFor, rankOf, countHan, clamp, round, newTier, LEVEL_ORDER, VOLUME_END, VOLUME_NAMES } from "./text.js";

// ---------------------------------------------------------------- dates
const DAY = 86400000;
/** YYYY-MM-DD in Asia/Shanghai. */
export function cnDate(ms = Date.now()) {
  return new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
}
export function addDays(date, n) {
  return new Date(Date.parse(date + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
}
export function diffDays(a, b) {
  return Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / DAY);
}

// ---------------------------------------------------------------- pick
/**
 * Score reading candidates for this child (§3 "从易到难", §6 spaced review).
 * candidates: [{id, uniq, difficulty, genre, tags:[], charCount}]
 * ctx: {known:Set, due:Set, upcoming:Set, recentGenres:[], interests:[], targetNew}
 * Returns candidates sorted best-first with score + reason.
 */
export function rankCandidates(candidates, ctx) {
  const target = ctx.targetNew ?? 5;
  const out = [];
  for (const c of candidates) {
    const { teachable, all } = newCharsFor(c.uniq || "", ctx.known);
    const n = teachable.length;
    let score = -Math.abs(n - target) * 10;
    if (n > target * 2 + 2) score -= 40; // far too hard for this child now
    if (all.length - n > 6) score -= 10; // many rare chars (pinyin crutch only)
    const reasons = [`生字 ${n} 个`];
    let dueHits = 0;
    for (const ch of c.uniq || "") if (ctx.due.has(ch)) dueHits++;
    if (dueHits) {
      score += Math.min(dueHits, 5) * 6;
      reasons.push(`复现待复习字 ${dueHits} 个`);
    }
    const upHits = teachable.filter((ch) => ctx.upcoming.has(ch)).length;
    if (upHits) {
      score += Math.min(upHits, 4) * 3;
      reasons.push(`含课本生字 ${upHits} 个`);
    }
    const recent = ctx.recentGenres || [];
    if (c.genre && recent.slice(0, 2).includes(c.genre)) score -= 8;
    const tags = c.tags || [];
    const interest = (ctx.interests || []).filter((t) => tags.includes(t) || c.genre === t);
    if (interest.length) {
      score += 6;
      reasons.push(`兴趣：${interest.join("、")}`);
    }
    if (c.charCount >= 600 && c.charCount <= 900) score += 5;
    score -= (c.difficulty || 0) * 0.1;
    out.push({ ...c, newCount: n, newChars: teachable, tier: newTier(n), score: round(score, 1), reason: reasons.join("，") });
  }
  const TIER_ORDER = { pass: 0, review: 1, later: 2 };
  // tier first (从易到难): a "later" article is only chosen when nothing easier
  // exists, and then the one with the fewest new characters
  return out.sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier]
    || (a.tier === "later" ? a.newCount - b.newCount : 0)
    || b.score - a.score || a.id - b.id);
}

/**
 * Adapt the new-character target to recent results: two weak sessions in a
 * row step down one notch, three strong ones step up (§3 难度回退).
 */
export function adaptTarget(current, recentAccuracies) {
  const [a, b, c] = recentAccuracies;
  if (a != null && b != null && a < 0.6 && b < 0.6) return Math.max(2, current - 1);
  if (a != null && b != null && c != null && a >= 0.9 && b >= 0.9 && c >= 0.9) return Math.min(8, current + 1);
  return current;
}

// ---------------------------------------------------------------- verdict
export const PASS_ACCURACY = 0.7;
export const FAST_PASS_ACCURACY = 0.9;
export const RECOVERY_FIRST_TRY = 0.5;
export const MAX_ATTEMPTS = 3; // per question: answer, look back + retry, re-read + retry
/** Minimum believable reading time: 10 chars/second is skimming for grade 4. */
export const MIN_MS_PER_CHAR = 100;
/** A paragraph counts as read when it stayed on screen ~3.5 chars/second or slower. */
export const PARA_MS_PER_CHAR = 60;

export const ABILITY_WEIGHT = { locate: 2, infer: 1.5, extract: 1, word: 1, summarise: 1, theme: 1 };

/**
 * "完成今日阅读" judgement (§10). Process signals support; comprehension
 * gates. Inputs:
 *   paras: [hanCount per paragraph]
 *   dwell: [ms per paragraph]
 *   activeMs
 *   answers: [{questionId, ability, correct, attempt, evidence}]
 *   charQuiz: [{correct}]
 */
export function verdict({ paras, dwell, activeMs, answers, charQuiz }) {
  const total = paras.reduce((a, b) => a + b, 0);
  const unread = [];
  paras.forEach((n, i) => {
    const need = Math.min(n * PARA_MS_PER_CHAR, 20000);
    if (!((dwell[i] || 0) >= need)) unread.push(i);
  });
  const readBody = unread.length === 0;
  const tooFast = activeMs < total * MIN_MS_PER_CHAR;

  // per question: first attempt, and whether it was eventually answered right
  const byQ = new Map();
  for (const a of answers) {
    const q = byQ.get(a.questionId) || { ability: a.ability, evidence: a.evidence, first: null, final: 0 };
    if (a.attempt === 1 && q.first === null) q.first = a.correct;
    if (a.correct) q.final = 1;
    byQ.set(a.questionId, q);
  }
  let w = 0, gotFirst = 0, gotFinal = 0;
  const wrong = [];
  for (const [id, q] of byQ) {
    const weight = ABILITY_WEIGHT[q.ability] || 1;
    w += weight;
    if (q.first) gotFirst += weight;
    if (q.final) gotFinal += weight;
    else wrong.push({ questionId: id, evidence: q.evidence });
  }
  const firstTry = w ? gotFirst / w : 0;
  const score = w ? gotFinal / w : 0;
  const cqOk = charQuiz.filter((c) => c.correct).length;
  const charPass = charQuiz.length === 0 || cqOk / charQuiz.length >= 0.6;
  const need = tooFast ? FAST_PASS_ACCURACY : PASS_ACCURACY;
  // Main gate: first-try accuracy. Recovery path: looked back in the text
  // and found every answer, with the body genuinely read (not skimmed) and
  // at least half right first time — guessing alone cannot get through.
  const recovered = score === 1 && readBody && !tooFast && firstTry >= RECOVERY_FIRST_TRY;
  const comprehension = byQ.size > 0 && (firstTry >= need || recovered);
  const completed = comprehension && charPass;

  let hint = null;
  if (!completed) {
    if (!comprehension) {
      const evid = [...new Set(wrong.map((x) => x.evidence).filter((x) => x != null))].sort((a, b) => a - b);
      hint = evid.length
        ? `回到第 ${evid.map((i) => i + 1).join("、")} 段再看看，答案就藏在里面。`
        : tooFast || !readBody
          ? "读得有点快，慢慢再读一遍，字会更听话。"
          : "再回原文看看，慢一点读，答案就藏在里面。";
    } else hint = "生字还差一点点，再和它们见一面吧。";
  }
  return {
    level: completed ? 2 : readBody ? 1 : 0,
    completed,
    recovered: completed && firstTry < need,
    readBody,
    tooFast,
    unread,
    accuracy: round(firstTry, 3),
    score: round(score, 3),
    charOk: cqOk,
    charTotal: charQuiz.length,
    retryQuestions: completed ? [] : wrong.map((x) => x.questionId),
    hint,
    minutes: round(activeMs / 60000, 1),
    speed: activeMs ? Math.round(total / (activeMs / 60000)) : null, // chars per minute
  };
}

// ---------------------------------------------------------------- SRS
/** Review intervals by number of distinct articles answered right. */
export const INTERVALS = [1, 2, 4, 7, 14, 30];
export const MASTER_AFTER = 3; // distinct articles

/**
 * Next state of one archive row after a quiz answer in article `articleId`
 * on `today`. Status only moves one step; nothing is "punished" (§8).
 */
export function srsUpdate(row, correct, articleId, today) {
  const r = { ...row, correctArticles: [...(row.correctArticles || [])] };
  if (correct) {
    if (!r.correctArticles.includes(articleId)) r.correctArticles.push(articleId);
    const n = r.correctArticles.length;
    if (r.status === "seen") r.status = "familiar";
    if (n >= MASTER_AFTER && r.status !== "mastered") {
      r.status = "mastered";
      r.masteredAt = today;
    }
    r.dueAt = r.status === "mastered" ? null : addDays(today, INTERVALS[Math.min(n, INTERVALS.length - 1)]);
  } else {
    r.lapses = (r.lapses || 0) + 1;
    if (r.status === "mastered") {
      r.status = "familiar";
      r.masteredAt = null;
    } else if (r.status === "familiar") r.status = "seen";
    r.dueAt = addDays(today, 1);
  }
  return r;
}

// ---------------------------------------------------------------- assessment
/**
 * Assessment levels follow the textbooks: one level per volume 一上 … 五下
 * (六年级 adds almost no new recognition characters and joins 五下), then
 * one level for common characters the primary textbooks never teach.
 */
const LEVEL_BOUNDS = [0, ...VOLUME_END.slice(0, 9), VOLUME_END[11], LEVEL_ORDER.length];
export const ASSESS_LEVELS = LEVEL_BOUNDS.length - 1; // 11
export const ASSESS_PER_LEVEL = 8;
export const LEVEL_NAMES = [...VOLUME_NAMES.slice(0, 9), "五、六年级", "课本以外的常用字"];
export function levelSize(level) {
  return LEVEL_BOUNDS[level + 1] - LEVEL_BOUNDS[level];
}
export function levelChars(level) {
  return LEVEL_ORDER.slice(LEVEL_BOUNDS[level], LEVEL_BOUNDS[level + 1]);
}
/** Name of the textbook level a known-set size reaches ("约到 三年级上册"). */
export function levelReached(estimate) {
  let name = "一年级上册之前";
  for (let l = 0; l < ASSESS_LEVELS; l++) if (estimate >= LEVEL_BOUNDS[l + 1] * 0.9) name = LEVEL_NAMES[l];
  return name;
}

/** Deterministic sample of `k` chars from a level (seeded). */
export function sampleLevel(level, k, seed) {
  const chars = levelChars(level);
  const out = [];
  let s = (seed * 9301 + level * 49297 + 233280) % 233280;
  const used = new Set();
  while (out.length < k && used.size < chars.length) {
    s = (s * 9301 + 49297) % 233280;
    const i = Math.floor((s / 233280) * chars.length);
    if (used.has(i)) continue;
    used.add(i);
    out.push(chars[i]);
  }
  return out;
}

/**
 * Turn assessment results into a known set.
 * results: [{level, char, correct}] in level order; testing stopped after
 * the first level below 50%.
 * Levels ≥80% → whole level inferred known; otherwise only the chars
 * answered right. Estimate = Σ level size × level accuracy.
 * Levels follow the textbook volumes (see LEVEL_BOUNDS).
 */
export function scoreAssessment(results) {
  const byLevel = new Map();
  for (const r of results) {
    const l = byLevel.get(r.level) || { level: r.level, right: 0, total: 0 };
    l.total++;
    if (r.correct) l.right++;
    byLevel.set(r.level, l);
  }
  const levels = [...byLevel.values()].sort((a, b) => a.level - b.level);
  const known = new Map(); // char -> origin
  let estimate = 0;
  for (const l of levels) {
    const acc = l.right / l.total;
    l.accuracy = round(acc, 2);
    estimate += levelSize(l.level) * acc;
    if (acc >= 0.8) for (const ch of levelChars(l.level)) known.set(ch, "inferred");
  }
  for (const r of results) if (r.correct) known.set(r.char, "assessment");
  for (const l of levels) l.name = LEVEL_NAMES[l.level];
  return { levels, estimate: Math.round(estimate), known, reached: levelReached(Math.round(estimate)) };
}

/** Should the assessment continue after finishing `level` with these answers? */
export function assessContinue(levelResults) {
  const right = levelResults.filter((r) => r.correct).length;
  return right / levelResults.length >= 0.5;
}

// ---------------------------------------------------------------- rewards
export const BONES = { daily: 10, extra: 5, accuracy: 3, charQuiz: 2, extraCapPerDay: 1 };

export const PUPPY_STAGES = [
  { min: 0, name: "小奶狗", key: "pup" },
  { min: 7, name: "小猎犬", key: "young" },
  { min: 25, name: "追踪犬", key: "tracker" },
  { min: 60, name: "金牌追踪犬", key: "gold" },
  { min: 120, name: "传奇猎犬", key: "legend" },
];
export function puppyStage(completed) {
  let s = PUPPY_STAGES[0];
  for (const p of PUPPY_STAGES) if (completed >= p.min) s = p;
  const next = PUPPY_STAGES.find((p) => p.min > completed) || null;
  return { ...s, next: next ? { name: next.name, need: next.min - completed } : null };
}

export const MAP_REGIONS = ["拼音草原", "汉字森林", "成语山谷", "神话之河", "故事城堡", "科学港湾", "诗词云岛", "智慧高塔"];
export const NODES_PER_REGION = 10;
export function mapPosition(completed) {
  const region = Math.floor(completed / NODES_PER_REGION);
  return {
    region: MAP_REGIONS[Math.min(region, MAP_REGIONS.length - 1)],
    regionIndex: region,
    node: completed % NODES_PER_REGION,
    perRegion: NODES_PER_REGION,
  };
}

/** Medals earned given totals; caller filters ones already awarded. */
export function medalsFor({ streak, completed, mastered, charsRead }) {
  const m = [];
  for (const d of [7, 30, 100]) if (streak >= d) m.push({ code: `medal:streak${d}`, title: `连续阅读 ${d} 天` });
  for (const n of [1, 10, 30, 100, 200]) if (completed >= n) m.push({ code: `medal:read${n}`, title: n === 1 ? "第一篇通关" : `读完 ${n} 篇` });
  for (let n = 50; n <= mastered; n += 50) m.push({ code: `medal:chars${n}`, title: `驯服 ${n} 个生字` });
  for (const n of [10000, 50000, 100000]) if (charsRead >= n) m.push({ code: `medal:words${n}`, title: `累计读 ${n / 10000} 万字` });
  return m;
}

/**
 * Streak over day rows (desc by date, any order accepted). A day counts if
 * completed or covered by a freeze. Today not yet done does not break it.
 */
export function streakFrom(days, today) {
  const ok = new Set(days.filter((d) => d.completed || d.freeze_used).map((d) => d.date));
  let cur = ok.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (ok.has(cur)) {
    n++;
    cur = addDays(cur, -1);
  }
  return n;
}

/** Freezes: one earned per 7-day streak block, at most 2 banked. */
export const MAX_FREEZES = 2;

// ---------------------------------------------------------------- eye care
function minutesOf(hhmm) {
  const [h, m] = String(hhmm || "0:0").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
/**
 * §15: beyond the daily screen limit, or outside waking hours, reading
 * switches to listen-only (audio, no lit text).
 */
export function eyeCare(settings, screenMs, nowMs = Date.now()) {
  const d = new Date(nowMs + 8 * 3600000);
  const now = d.getUTCHours() * 60 + d.getUTCMinutes();
  const bed = minutesOf(settings.bedtime), wake = minutesOf(settings.wake_time);
  const night = bed > wake ? now >= bed || now < wake : now >= bed && now < wake;
  const used = Math.round(screenMs / 60000);
  const over = settings.daily_limit_min > 0 && used >= settings.daily_limit_min;
  return {
    listenOnly: night || over,
    reason: night ? "bedtime" : over ? "limit" : null,
    usedMin: used,
    limitMin: settings.daily_limit_min,
    sessionMin: settings.session_min,
    restMin: settings.rest_min,
  };
}

// ---------------------------------------------------------------- skills
export function skillsFor(completed, every = 5) {
  return [
    { key: "extract", name: "找信息", desc: "答案藏在文章里，回去找一找", at: 0, phase: 1 },
    { key: "purpose", name: "带着问题读", desc: "读之前先接一个观察任务", at: every, phase: 1 },
    { key: "guess", name: "猜词义", desc: "联系上下文，猜猜生词的意思", at: every * 2, phase: 1 },
    { key: "predict", name: "预测", desc: "读到一半，猜猜后面会怎样", at: null, phase: 2 },
    { key: "locate", name: "回文定位", desc: "在原文中点出依据句", at: null, phase: 2 },
    { key: "summarise", name: "概括段意", desc: "每段说了什么，拼成文章地图", at: null, phase: 2 },
    { key: "retell", name: "语音复述", desc: "读完用自己的话讲一遍", at: null, phase: 2 },
  ].map((s) => ({ ...s, unlocked: s.at !== null && completed >= s.at, need: s.at === null ? null : Math.max(0, s.at - completed) }));
}

export { countHan, clamp, rankOf };
