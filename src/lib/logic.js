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
    if (ctx.genreCounts && c.genre) {
      const reg = regionOf(c.genre);
      if (!reg.genres.some((g) => ctx.genreCounts[g])) {
        score += 3;
        reasons.push(`去新地区：${reg.name}`);
      }
    }
    const tags = c.tags || [];
    const gname = ctx.genreName ? ctx.genreName(c.genre) || "" : "";
    const interest = (ctx.interests || []).filter((t) => tags.includes(t) || c.genre === t || (gname && gname.includes(t)));
    if (interest.length) {
      score += 6;
      reasons.push(`兴趣：${interest.join("、")}`);
    }
    // the class's current unit: same genre or topic → read alongside school
    const unit = ctx.unit;
    if (unit) {
      const topics = String(unit.topics || "").split(/[、,，\s]+/).filter((t) => t.length >= 2);
      const hit = topics.find((t) => (c.title || "").includes(t) || tags.includes(t));
      if (hit || (unit.genre && c.genre === unit.genre)) {
        score += hit ? 8 : 4;
        reasons.push(`配合课本：${unit.theme}`);
      }
    }
    // the next part of a story already begun: keep the thread going
    if (c.continues) {
      score += 12;
      reasons.push("接着读上一篇的后续");
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
 * 每日二选一: alternatives to the best pick from the same ranked list — as
 * suitable (same tier, a "later" only when the best is one), not far behind
 * in score, and a different genre where possible so the choice is real.
 */
export const CHOICE_ALTS = 2;
export const CHOICE_MAX_GAP = 30; // score points behind the best
export function pickChoices(ranked, n = CHOICE_ALTS) {
  const [best, ...rest] = ranked;
  if (!best) return [];
  const fit = rest.filter((c) => c.tier === best.tier && best.score - c.score <= CHOICE_MAX_GAP);
  const out = [];
  const genres = new Set([best.genre]);
  for (const c of fit) if (out.length < n && !genres.has(c.genre)) { out.push(c); genres.add(c.genre); }
  for (const c of fit) if (out.length < n && !out.includes(c)) out.push(c);
  return out;
}

/**
 * 错题回炉: which earlier misses come back today. rows: one per question
 * missed first time [{questionId, date (of the miss), reviews: [{date, correct}]}].
 * A question is done once answered right in review, or after REVIEW_MAX
 * tries; otherwise it is due the day after the miss / the last wrong review.
 * Most recent misses first.
 */
export const REVIEW_PER_DAY = 2;
export const REVIEW_MAX = 3;
export const REVIEW_WINDOW_DAYS = 14;
export function dueReviews(rows, today, n = REVIEW_PER_DAY) {
  return rows
    .filter((r) => {
      const rv = r.reviews || [];
      if (rv.some((x) => x.correct) || rv.length >= REVIEW_MAX) return false;
      const last = rv.length ? rv.map((x) => x.date).sort().pop() : r.date;
      return last < today;
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.questionId - b.questionId))
    .slice(0, n);
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
/** Unsuccessful finishes of one session before "读完也算数" lets the child through. */
export const MAX_FAILS = 3;
/** Minimum believable reading time: 10 chars/second is skimming for grade 4. */
export const MIN_MS_PER_CHAR = 100;
/** A paragraph counts as read when it stayed on screen ~3.5 chars/second or slower. */
export const PARA_MS_PER_CHAR = 60;
export const CHAR_PASS = 0.6;

export const ABILITY_WEIGHT = { locate: 2, infer: 1.5, extract: 1, word: 1, summarise: 1, theme: 1 };

/**
 * "完成今日阅读" judgement (§10). Process signals support; comprehension
 * gates. Inputs:
 *   paras: [hanCount per paragraph]
 *   dwell: [ms per paragraph]
 *   activeMs
 *   answers: [{questionId, ability, correct, attempt, evidence}]
 *   charQuiz: [{correct}]
 *   fails: unsuccessful finishes of this session before this one
 *
 * Pass tiers (best first):
 *   pass      — first-try accuracy ≥ 0.7 (0.9 when skimmed) and the char quiz
 *   recovered — at least half right first time, then found every answer
 *   found     — 找回答案: every answer found in the end, body read slowly;
 *               fewer bones, but never a dead end
 *   effort    — 读完也算数: the body was read and no door is left (or the
 *               third try): base bones, the misses stay in the parent report
 * The first-try accuracy stays what it is for the report and the difficulty
 * engine; only the gate is softened.
 */
export function verdict({ paras, dwell, activeMs, answers, charQuiz, fails = 0 }) {
  const total = paras.reduce((a, b) => a + b, 0);
  const unread = [];
  paras.forEach((n, i) => {
    const need = Math.min(n * PARA_MS_PER_CHAR, 20000);
    if (!((dwell[i] || 0) >= need)) unread.push(i);
  });
  const readBody = unread.length === 0;
  const tooFast = activeMs < total * MIN_MS_PER_CHAR;

  // per question: first attempt, tries, and whether it was eventually answered right
  const byQ = new Map();
  for (const a of answers) {
    const q = byQ.get(a.questionId) || { ability: a.ability, evidence: a.evidence, first: null, final: 0, tries: 0 };
    if (a.attempt === 1 && q.first === null) q.first = a.correct;
    if (a.correct) q.final = 1;
    q.tries = Math.max(q.tries, a.attempt);
    byQ.set(a.questionId, q);
  }
  let w = 0, gotFirst = 0, gotFinal = 0, firstRight = 0;
  const wrong = [];
  for (const [id, q] of byQ) {
    const weight = ABILITY_WEIGHT[q.ability] || 1;
    w += weight;
    if (q.first) { gotFirst += weight; firstRight++; }
    if (q.final) gotFinal += weight;
    else wrong.push({ questionId: id, evidence: q.evidence, tries: q.tries });
  }
  const firstTry = w ? gotFirst / w : 0;
  const score = w ? gotFinal / w : 0;
  const cqOk = charQuiz.filter((c) => c.correct).length;
  const charNeed = Math.ceil(charQuiz.length * CHAR_PASS);
  const charPass = cqOk >= charNeed;
  const need = tooFast ? FAST_PASS_ACCURACY : PASS_ACCURACY;
  const careful = readBody && !tooFast;
  const answeredAll = byQ.size > 0 && score === 1;

  let tier = null;
  if (byQ.size > 0 && charPass) {
    if (firstTry >= need) tier = "pass";
    else if (answeredAll && careful && firstTry >= RECOVERY_FIRST_TRY) tier = "recovered";
    else if (answeredAll && careful) tier = "found";
  }
  // no door left: every missed question has used its tries
  const retryable = wrong.filter((x) => x.tries < MAX_ATTEMPTS);
  const stuck = !answeredAll && retryable.length === 0;
  if (!tier && byQ.size > 0 && careful && (stuck || fails + 1 >= MAX_FAILS)) tier = "effort";
  const completed = tier !== null;
  const comprehension = byQ.size > 0 && (firstTry >= need || answeredAll && careful);

  // what is still missing, said plainly (the child sees it on the "almost" page)
  const gates = {
    questions: { found: byQ.size - wrong.length, total: byQ.size, firstRight, ok: comprehension },
    chars: { right: cqOk, need: charNeed, total: charQuiz.length, ok: charPass },
    reading: { ok: careful, unread: unread.length, tooFast },
  };
  let hint = null;
  if (!completed) {
    const evid = [...new Set(retryable.map((x) => x.evidence).filter((x) => x != null))].sort((a, b) => a - b);
    if (!comprehension && retryable.length) {
      hint = `还有 ${retryable.length} 道题没找到答案` + (evid.length ? `，回到第 ${evid.map((i) => i + 1).join("、")} 段找一找。` : "，回原文找一找。");
    } else if (!careful) {
      hint = unread.length
        ? `还有 ${unread.length} 段读得太快，慢慢再读一遍，字会更听话。`
        : "读得有点快，慢慢再读一遍，字会更听话。";
    } else if (!charPass) {
      hint = `生字小测对了 ${cqOk}/${charQuiz.length} 个，要对 ${charNeed} 个，再和生字见一面吧。`;
    } else hint = "再回原文看看，慢一点读，答案就藏在里面。";
  }
  return {
    level: completed ? 2 : readBody ? 1 : 0,
    completed,
    tier,
    recovered: completed && tier !== "pass",
    fails: completed ? fails : fails + 1,
    readBody,
    tooFast,
    unread,
    accuracy: round(firstTry, 3),
    score: round(score, 3),
    charOk: cqOk,
    charTotal: charQuiz.length,
    gates,
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
export const BONES = { daily: 10, extra: 5, accuracy: 3, charQuiz: 2, retell: 3, extraCapPerDay: 1 };
export const RETELL_PASS = 0.6; // share of key points told → 完成复述（优秀）
export const RETELL_MAX = 2; // live model calls per session
export const FLUENCY_DAILY = 15; // paragraphs read aloud per day (speech recognition calls)

export const PUPPY_STAGES = [
  { min: 0, name: "小奶狗", key: "pup" },
  { min: 3, name: "小猎犬", key: "young" }, // the first growth in the first week
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

/**
 * 闯关地图: each region is lit by reading its genres (读神话点亮神话之河), so
 * the map shows what the child has read, not just how much. Every region a
 * child has read 3+ times adds a floor to 智慧高塔.
 */
export const MAP_REGIONS = [
  { key: "story", name: "故事城堡", icon: "🏰", genres: ["story", "life"] },
  { key: "fairy", name: "童话森林", icon: "🌳", genres: ["fairy"] },
  { key: "fable", name: "寓言草原", icon: "🦊", genres: ["fable"] },
  { key: "idiom", name: "成语山谷", icon: "⛰", genres: ["idiom"] },
  { key: "myth", name: "神话之河", icon: "🐉", genres: ["myth"] },
  { key: "science", name: "科学港湾", icon: "🔬", genres: ["science"] },
  { key: "history", name: "历史古城", icon: "🏯", genres: ["history"] },
  { key: "poem", name: "诗词云岛", icon: "☁", genres: ["poem"] },
];
export const NODES_PER_REGION = 10;
export const TOWER_AFTER = 3; // reads in a region for a tower floor
/** The region an article's genre belongs to (unknown genres: the story castle). */
export function regionOf(genre) {
  return MAP_REGIONS.find((r) => r.genres.includes(genre)) || MAP_REGIONS[0];
}
/** genreCounts: {genre: completed articles}. */
export function mapState(genreCounts = {}) {
  const regions = MAP_REGIONS.map((r) => {
    const count = r.genres.reduce((n, g) => n + (genreCounts[g] || 0), 0);
    return { key: r.key, name: r.name, icon: r.icon, count, lit: Math.min(count, NODES_PER_REGION), full: count >= NODES_PER_REGION };
  });
  const unknown = Object.entries(genreCounts).filter(([g]) => !MAP_REGIONS.some((r) => r.genres.includes(g))).reduce((n, [, c]) => n + c, 0);
  if (unknown) { regions[0].count += unknown; regions[0].lit = Math.min(regions[0].count, NODES_PER_REGION); regions[0].full = regions[0].count >= NODES_PER_REGION; }
  return {
    regions,
    perRegion: NODES_PER_REGION,
    explored: regions.filter((r) => r.count > 0).length,
    tower: { floors: regions.filter((r) => r.count >= TOWER_AFTER).length, total: regions.length },
    unexplored: regions.filter((r) => r.count === 0).map((r) => r.name),
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
/**
 * Skill unlocks. Reading aloud and retelling are the tools a weak reader
 * needs most, so they come first (朗读 from the first completed article,
 * without a score in the first week); the technique skills follow.
 */
export const READALOUD_SCORE_AFTER = 7; // completed articles before 朗读 shows a percentage
export function skillsFor(completed, every = 5) {
  return [
    { key: "extract", name: "找信息", desc: "答案藏在文章里，回去找一找", at: 0, phase: 1 },
    { key: "readaloud", name: "大声朗读", desc: "把一段读给小猎犬听，看看读得准不准、顺不顺", at: Math.min(1, every), phase: 1 },
    { key: "purpose", name: "带着问题读", desc: "读之前先接一个观察任务", at: every, phase: 1 },
    { key: "retell", name: "语音复述", desc: "读完用自己的话讲一遍", at: every * 2, phase: 1 },
    { key: "guess", name: "猜词义", desc: "联系上下文，猜猜生词的意思", at: every * 3, phase: 2 },
    { key: "predict", name: "预测", desc: "读到一半，猜猜后面会怎样", at: every * 4, phase: 2 },
    { key: "locate", name: "回文定位", desc: "在原文中点出依据句", at: every * 5, phase: 2 },
    { key: "summarise", name: "概括段意", desc: "每段说了什么，拼成文章地图", at: every * 6, phase: 2 },
  ].map((s) => ({ ...s, unlocked: s.at !== null && completed >= s.at, need: s.at === null ? null : Math.max(0, s.at - completed) }));
}

export { countHan, clamp, rankOf };

// ---------------------------------------------------------------- weekly digest
/** Monday (YYYY-MM-DD) of the week `date` is in. */
export function weekStart(date) {
  const dow = new Date(date + "T00:00:00Z").getUTCDay(); // 0 = Sunday
  return addDays(date, -((dow + 6) % 7));
}

const pctText = (x) => (x == null ? "—" : `${Math.round(x * 100)}%`);
/**
 * The one-glance weekly card (家长周报): days read, characters, the weakest
 * skill and one thing to do. d: see parent.weeklyDigest().
 */
export function digestText(d) {
  const lines = [`【字游记周报】${d.name} ${d.from.slice(5)}～${d.to.slice(5)}`];
  lines.push(`📅 读了 ${d.daysRead}/7 天，通关 ${d.articles} 篇，共 ${d.chars} 字，用时 ${d.minutes} 分钟`);
  if (d.knownNow != null) lines.push(`🔤 认识的字 ${d.knownNow}` + (d.knownDelta ? `（本周 +${d.knownDelta}）` : ""));
  if (d.firstTry != null) {
    const trend = d.firstTryPrev == null ? "" : d.firstTry > d.firstTryPrev + 0.02 ? "，比上周↑" : d.firstTry < d.firstTryPrev - 0.02 ? "，比上周↓" : "，和上周持平";
    lines.push(`🎯 首答正确率 ${pctText(d.firstTry)}${trend}`);
  }
  if (d.weak) lines.push(`🧩 最弱技能：${d.weak.name}（${d.weak.rate}%）`);
  lines.push(`💡 ${d.tip}`);
  return lines.join("\n");
}

/** Body for a chat-bot webhook: 企业微信 / 钉钉 / 飞书 by host, else {text}. */
export function webhookPayload(url, text) {
  const host = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
  if (/(^|\.)qyapi\.weixin\.qq\.com$|(^|\.)oapi\.dingtalk\.com$/.test(host)) return { msgtype: "text", text: { content: text } };
  if (/(^|\.)(feishu\.cn|larksuite\.com)$/.test(host)) return { msg_type: "text", content: { text } };
  return { text };
}
