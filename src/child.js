// Child-facing API: home, daily pick, reading session, quest, rewards,
// assessment, character archive. The reading path never calls a model.
import { all, first, run, stmt, batch, getSettings, setSetting, knownSet } from "./db.js";
import { paragraphs, countHan, rankOf, newCharsFor, textbookInfo, splitSentences } from "./lib/text.js";
import { readingOf, pinyinChoices } from "./lib/pinyin.js";
import { pinyin as pinyinPro } from "pinyin-pro";
import { ensureGlosses, enqueueGenerated } from "./pipeline.js";
import { currentUnit } from "./curriculum.js";
import {
  cnDate, addDays, rankCandidates, pickChoices, dueReviews, REVIEW_WINDOW_DAYS, REVIEW_MAX, adaptTarget, verdict, srsUpdate, sampleLevel, scoreAssessment,
  ASSESS_LEVELS, ASSESS_PER_LEVEL, LEVEL_NAMES, BONES, puppyStage, mapState, regionOf, medalsFor, streakFrom, MAX_FREEZES,
  eyeCare, skillsFor, READALOUD_SCORE_AFTER, MAX_ATTEMPTS, RETELL_PASS, RETELL_MAX, FLUENCY_DAILY,
} from "./lib/logic.js";
import { openChest } from "./data/surprises.js";
import { compareReading } from "./lib/fluency.js";
import { GENRE_NAMES, ABILITY_NAMES, transcribe, assessRetell, isQuotaError } from "./lib/ai.js";

const MAX_NEW_CARDS = 8;
/** The new characters a session teaches: the most useful (most frequent) first. */
export function teachList(newChars) {
  return [...newChars].sort((x, y) => rankOf(x) - rankOf(y)).slice(0, MAX_NEW_CARDS);
}
const MAX_QUIZ_NEW = 6;
const MAX_QUIZ_REVIEW = 3;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ================================================================ summaries
/**
 * Wait for background AI work only briefly: a child's tap must not hang on a
 * model call. The work goes on (waitUntil) and its result is there next time.
 */
async function soon(ctx, job, ms = 3000) {
  if (!ctx) return job;
  ctx.waitUntil(job);
  if (ms > 0) await Promise.race([job, new Promise((r) => setTimeout(r, ms))]);
}

async function completedCount(env) {
  return (await first(env, "SELECT COUNT(*) n FROM sessions WHERE level >= 2")).n;
}

/** Completed readings per genre (the map is lit by what was read). */
async function genreCounts(env) {
  const rows = await all(env, "SELECT a.genre, COUNT(*) n FROM sessions s JOIN articles a ON a.id = s.article_id WHERE s.level >= 2 GROUP BY a.genre");
  return Object.fromEntries(rows.map((r) => [r.genre || "story", r.n]));
}

async function bonesBalance(env) {
  return (await first(env, "SELECT COALESCE(SUM(amount), 0) n FROM ledger")).n;
}

/** Streak, consuming a banked freeze for a single missed day (補簽, §8). */
export async function streakInfo(env, today, settings) {
  let days = await all(env, "SELECT date, completed, freeze_used FROM days WHERE date >= ? ORDER BY date DESC", addDays(today, -400));
  const yesterday = addDays(today, -1);
  const ok = (d) => days.some((x) => x.date === d && (x.completed || x.freeze_used));
  // missed exactly yesterday, but the day before counted: spend a freeze
  if (!ok(yesterday) && ok(addDays(today, -2)) && settings.freezes > 0) {
    await run(env, "INSERT INTO days (date, freeze_used) VALUES (?, 1) ON CONFLICT(date) DO UPDATE SET freeze_used = 1", yesterday);
    await setSetting(env, "freezes", settings.freezes - 1);
    settings.freezes -= 1;
    days = [{ date: yesterday, completed: 0, freeze_used: 1 }, ...days];
  }
  return { streak: streakFrom(days, today), freezes: settings.freezes, todayDone: ok(today) && days.find((d) => d.date === today)?.completed === 1 };
}

// ================================================================ daily pick
async function candidatePool(env, excludeIds) {
  // a part of a long text is offered once every earlier part (still in play) has been read
  const rows = await all(env, `SELECT a.id, a.title, a.uniq, a.difficulty, a.genre, a.tags, a.char_count, a.series, a.part,
      EXISTS (SELECT 1 FROM articles e WHERE e.series = a.series AND e.part < a.part) AS continues
    FROM articles a
    WHERE a.status = 'ready' AND (a.series IS NULL OR NOT EXISTS (
      SELECT 1 FROM articles e WHERE e.series = a.series AND e.part < a.part
        AND e.status IN ('ready','queued','processing')
        AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.article_id = e.id AND s.level >= 2)))
    ORDER BY a.difficulty LIMIT 400`);
  return rows
    .filter((r) => !excludeIds.has(r.id))
    .map((r) => ({ id: r.id, title: r.title, uniq: r.uniq, difficulty: r.difficulty, genre: r.genre, tags: safeJSON(r.tags, []), charCount: r.char_count, continues: !!r.continues }));
}

async function pickContext(env, today, settings) {
  const [known, dueRows, upRows, recent, unit, counts] = await Promise.all([
    knownSet(env),
    all(env, "SELECT char FROM chars WHERE status IN ('seen','familiar') AND due_at <= ?", today),
    all(env, "SELECT char FROM textbook_chars"),
    all(env, "SELECT a.genre FROM daily_pick p JOIN articles a ON a.id = p.article_id WHERE p.date < ? ORDER BY p.date DESC LIMIT 3", today),
    currentUnit(env),
    genreCounts(env),
  ]);
  const due = new Set(dueRows.map((r) => r.char));
  const upcoming = new Set(upRows.map((r) => r.char));
  return { known, due, upcoming, recentGenres: recent.map((r) => r.genre), interests: settings.interests || [], targetNew: settings.target_new, unit,
    genreCounts: counts, genreName: (g) => GENRE_NAMES[g] };
}

async function readArticleIds(env) {
  return new Set((await all(env, "SELECT DISTINCT article_id FROM sessions WHERE level >= 2")).map((r) => r.article_id));
}

/** Today's pick, choosing it now if the cron has not. */
export async function ensurePick(env, today, ctx, waitMs = 0) {
  const have = await first(env, "SELECT p.article_id, p.reason, a.title, a.genre, a.char_count, a.status FROM daily_pick p JOIN articles a ON a.id = p.article_id WHERE p.date = ?", today);
  if (have && have.status === "ready") return have;
  const [settings, exclude, recentPicks] = await Promise.all([
    getSettings(env),
    readArticleIds(env),
    all(env, "SELECT article_id FROM daily_pick WHERE date >= ? AND date < ?", addDays(today, -30), today),
  ]);
  recentPicks.forEach((r) => exclude.add(r.article_id));
  let pool = await candidatePool(env, exclude);
  if (!pool.length) pool = await candidatePool(env, await readArticleIds(env)); // allow recently skipped picks again
  if (!pool.length) return null;
  const pc = await pickContext(env, today, settings);
  const ranked = rankCandidates(pool, pc);
  const best = ranked[0];
  const alts = pickChoices(ranked).map((c) => c.id);
  const reason = best.tier === "later" ? `${best.reason}（书库里暂无更合适的，先读最容易的一篇）` : best.reason;
  await run(env, "INSERT INTO daily_pick (date, article_id, reason, alts) VALUES (?, ?, ?, ?) ON CONFLICT(date) DO UPDATE SET article_id = excluded.article_id, reason = excluded.reason, alts = excluded.alts",
    today, best.id, reason, alts.length ? JSON.stringify(alts) : null);
  // backfill glosses for this child's new characters (AI; off the reading path when possible)
  const job = ensureGlosses(env, { id: best.id, title: best.title, body: (await first(env, "SELECT body FROM articles WHERE id = ?", best.id)).body }, teachList(best.newChars)).catch((e) => console.warn("[pick] gloss backfill failed", e?.message));
  await soon(ctx, job, waitMs);
  return { article_id: best.id, reason: best.reason, title: best.title, genre: best.genre, char_count: best.charCount };
}

/**
 * 每日二选一: today's pick and its alternatives, while the day's reading has
 * not started. Every one of them suits the child; the choice is the child's.
 */
async function todayChoices(env, today) {
  const p = await first(env, "SELECT article_id, alts FROM daily_pick WHERE date = ?", today);
  const alts = safeJSON(p?.alts, null);
  if (!alts?.length) return null;
  const ids = [p.article_id, ...alts];
  const rows = await all(env, `SELECT id, title, genre, char_count FROM articles WHERE status = 'ready' AND id IN (${ids.map(() => "?").join(",")})`, ...ids);
  const done = await readArticleIds(env);
  const list = ids.map((id) => rows.find((r) => r.id === id)).filter((r) => r && (r.id === p.article_id || !done.has(r.id)));
  if (list.length < 2) return null;
  return list.map((r) => ({ id: r.id, title: r.title, genre: GENRE_NAMES[r.genre] || r.genre, chars: r.char_count, current: r.id === p.article_id }));
}

/** What the child can say it likes (the screening AI tags articles with these words). */
export const INTEREST_CHOICES = ["动物", "科学", "冒险", "搞笑", "历史", "太空", "友情", "侦探", "神话", "恐龙", "自然", "运动"];

/**
 * 我喜欢读…: the child chooses its own interests. Replaces the parent's
 * picks from the same list; the parent's own words outside it stay.
 */
export async function setInterests(env, { tags }) {
  if (!Array.isArray(tags)) throw new HttpError(400, "tags must be a list");
  const chosen = [...new Set(tags.filter((t) => INTEREST_CHOICES.includes(t)))].slice(0, 6);
  const s = await getSettings(env);
  const kept = (s.interests || []).filter((t) => !INTEREST_CHOICES.includes(t));
  await setSetting(env, "interests", [...chosen, ...kept]);
  await setSetting(env, "interests_by_child", cnDate());
  return { interests: [...chosen, ...kept] };
}

/** The child picks today's article from the choices (before starting it). */
export async function choosePick(env, ctx, { articleId }) {
  const today = cnDate();
  if (await first(env, "SELECT 1 FROM sessions WHERE date = ? AND daily = 1 LIMIT 1", today)) throw new HttpError(409, "今天已经开始读了，明天再选");
  const choices = await todayChoices(env, today);
  const c = choices?.find((x) => x.id === Number(articleId));
  if (!c) throw new HttpError(400, "这篇不在今天的可选里");
  if (!c.current) {
    await run(env, "UPDATE daily_pick SET article_id = ?, reason = ? WHERE date = ?", c.id, "孩子自己选的", today);
    // the chosen one's glosses (AI) — usually quick, and the start waits for them anyway
    const a = await first(env, "SELECT id, title, body, uniq FROM articles WHERE id = ?", c.id);
    const { teachable } = newCharsFor(a.uniq || "", await knownSet(env));
    await soon(ctx, ensureGlosses(env, a, teachList(teachable)).catch((e) => console.warn("[choose] gloss backfill failed", e?.message)), 3000);
  }
  return home(env, ctx);
}

/**
 * §11 补位: when fewer than two unread articles suit this child (PASS or
 * REVIEW tier), write one. At most one a day; never before the baseline test.
 */
export async function maybeAutoGenerate(env) {
  const s = await getSettings(env);
  const today = cnDate();
  if (!s.auto_generate || s.last_auto_generate === today) return null;
  if (!(await first(env, "SELECT id FROM assessments LIMIT 1"))) return null;
  if (await first(env, "SELECT id FROM articles WHERE status IN ('queued','processing') AND stage = 'generate' LIMIT 1")) return null;
  const exclude = await readArticleIds(env);
  const pick = await first(env, "SELECT article_id FROM daily_pick WHERE date = ?", today);
  if (pick) exclude.add(pick.article_id);
  const ranked = rankCandidates(await candidatePool(env, exclude), await pickContext(env, today, s));
  const suitable = ranked.filter((c) => c.tier !== "later").length;
  if (suitable >= 2) return null;
  await setSetting(env, "last_auto_generate", today);
  const interests = s.interests || [];
  // the current textbook unit wins over interests (enqueueGenerated reads it when theme is empty)
  const unit = await currentUnit(env);
  return enqueueGenerated(env, { auto: true, theme: unit || !interests.length ? "" : interests[new Date().getDate() % interests.length] });
}

// ================================================================ home
export async function home(env, ctx) {
  const today = cnDate();
  const [settings, assessed] = await Promise.all([
    getSettings(env),
    first(env, "SELECT id, estimate, at FROM assessments ORDER BY id DESC LIMIT 1"),
  ]);
  const needAssessment = !assessed || settings.assessment_requested === true;
  // no pick before the baseline test: "new" is only meaningful against a known set
  const pick = needAssessment ? null : await ensurePick(env, today, ctx);
  // independent reads in parallel: each D1 query is a network round trip
  const [daySession, { streak, freezes, todayDone }, completed, counts, day, accessories, bones] = await Promise.all([
    pick ? first(env, "SELECT id, level, last_paragraph FROM sessions WHERE date = ? AND daily = 1 AND article_id = ? ORDER BY id DESC LIMIT 1", today, pick.article_id) : null,
    streakInfo(env, today, settings),
    completedCount(env),
    first(env, `SELECT
      SUM(CASE WHEN status IN ('familiar','mastered') THEN 1 ELSE 0 END) known,
      SUM(CASE WHEN status = 'mastered' AND origin IN ('reading','textbook') THEN 1 ELSE 0 END) tamed
    FROM chars`),
    first(env, "SELECT screen_ms, extra_bonus FROM days WHERE date = ?", today),
    all(env, "SELECT code, title FROM awards WHERE kind = 'accessory' ORDER BY at"),
    bonesBalance(env),
  ]);
  // 讲给小猎犬听: offered on the home card too, not only on the result page
  const skillList = skillsFor(completed, settings.skill_days);
  let canRetell = false;
  if (daySession?.level >= 2 && skillList.some((x) => x.key === "retell" && x.unlocked)) {
    const [q, told] = await Promise.all([
      first(env, "SELECT 1 FROM questions WHERE article_id = ? AND kind = 'retell'", pick.article_id),
      first(env, "SELECT COUNT(*) n FROM retells WHERE session_id = ?", daySession.id),
    ]);
    canRetell = !!q && !(told?.n > 0); // not told yet (the result page offers the second try)
  }
  return {
    today,
    childName: settings.child_name,
    needAssessment,
    article: pick ? { id: pick.article_id, title: pick.title, genre: GENRE_NAMES[pick.genre] || pick.genre, chars: pick.char_count } : null,
    session: daySession ? { id: daySession.id, level: daySession.level, lastParagraph: daySession.last_paragraph } : null,
    todayDone,
    streak,
    freezes,
    bones,
    completed,
    knownChars: counts?.known || 0,
    tamedChars: counts?.tamed || 0,
    puppy: puppyStage(completed),
    map: mapState(await genreCounts(env)),
    accessories,
    skills: skillList,
    eye: eyeCare(settings, day?.screen_ms || 0),
    canExtra: todayDone,
    canRetell,
    // 我喜欢读…: asked once on home; changeable from the likes page
    interests: settings.interests || [],
    askInterests: !settings.interests_by_child,
    // 每日二选一: offered until today's reading starts
    choices: pick && !daySession ? await todayChoices(env, today) : null,
  };
}

// ================================================================ session
export async function startSession(env, ctx, { extra = false } = {}) {
  const today = cnDate();
  const settings = await getSettings(env);
  let articleId, daily = 1;
  if (extra) {
    const [exclude, pickRow, open] = await Promise.all([
      readArticleIds(env),
      first(env, "SELECT article_id FROM daily_pick WHERE date = ?", today),
      // an unfinished extra reading from today is resumed
      first(env, "SELECT article_id FROM sessions WHERE date = ? AND daily = 0 AND level < 2 ORDER BY id DESC LIMIT 1", today),
    ]);
    if (pickRow) exclude.add(pickRow.article_id);
    if (open) articleId = open.article_id;
    else {
      const pool = await candidatePool(env, exclude);
      if (!pool.length) throw new HttpError(404, "书库里暂时没有新文章了");
      const best = rankCandidates(pool, await pickContext(env, today, settings))[0];
      articleId = best.id;
      const body = (await first(env, "SELECT body FROM articles WHERE id = ?", best.id)).body;
      await soon(ctx, ensureGlosses(env, { id: best.id, title: best.title, body }, teachList(best.newChars)).catch(() => {}));
    }
    daily = 0;
  } else {
    const pick = await ensurePick(env, today, ctx, 3000);
    if (!pick) throw new HttpError(404, "今天的故事还在准备中");
    articleId = pick.article_id;
  }

  let [a, s, completed] = await Promise.all([
    first(env, "SELECT * FROM articles WHERE id = ?", articleId),
    first(env, "SELECT * FROM sessions WHERE date = ? AND article_id = ? AND daily = ? ORDER BY id DESC LIMIT 1", today, articleId, daily),
    completedCount(env),
  ]);
  const skills = skillsFor(completed, settings.skill_days);
  const has = (k) => skills.some((x) => x.key === k && x.unlocked);

  let plan;
  if (s && s.new_chars) plan = JSON.parse(s.new_chars);
  else plan = await planChars(env, a, today);

  if (!s) {
    const r = await run(env, "INSERT INTO sessions (article_id, date, daily, new_chars, dwell) VALUES (?, ?, ?, ?, ?)", articleId, today, daily, JSON.stringify(plan), "[]");
    s = await first(env, "SELECT * FROM sessions WHERE id = ?", r.meta.last_row_id);
    await meetChars(env, plan.filter((p) => !p.review), a.id, today);
  }

  const paras = paragraphs(a.body);
  const py = safeJSON(a.pinyin, []);
  const audio = safeJSON(a.audio, []);
  const [glossRows, qs, answered, quizDone, day, retellRow] = await Promise.all([
    all(env, "SELECT char, pinyin, word, gloss, example FROM glosses WHERE article_id = ?", a.id),
    all(env, "SELECT id, ord, kind, ability, prompt, options, evidence, word, meta FROM questions WHERE article_id = ? ORDER BY ord", a.id),
    all(env, "SELECT question_id, correct, attempt, choice FROM answers WHERE session_id = ?", s.id),
    all(env, "SELECT char, correct, retry_ok FROM char_quiz WHERE session_id = ?", s.id),
    first(env, "SELECT screen_ms FROM days WHERE date = ?", today),
    first(env, "SELECT COUNT(*) n FROM retells WHERE session_id = ?", s.id),
  ]);
  const gl = new Map(glossRows.map((g) => [g.char, g]));
  const unglossed = plan.filter((p) => !gl.get(p.char)?.gloss).map((p) => p.char);
  if (unglossed.length && ctx) ctx.waitUntil(ensureGlosses(env, a, unglossed).catch((e) => console.warn("[session] gloss backfill failed", e?.message)));
  const purpose = has("purpose") ? safeJSON(a.purpose, null) : null;
  const review = s.daily ? await reviewItems(env, today, a.id) : [];
  const choiceQs = qs.filter((q) => q.kind === "choice");
  const guess = has("guess") ? qs.find((q) => q.kind === "guess") : null;
  const predict = has("predict") ? qs.find((q) => q.kind === "predict") : null;
  const locates = has("locate") ? qs.filter((q) => q.kind === "locate") : [];
  const sections = has("summarise") ? qs.filter((q) => q.kind === "section") : [];
  const retellQ = has("retell") ? qs.find((q) => q.kind === "retell") : null;
  const retells = retellQ ? retellRow?.n || 0 : 0;

  const card = (p) => {
    const g = gl.get(p.char) || {};
    return { char: p.char, pinyin: p.py, word: g.word || null, gloss: g.gloss || null, example: g.example || null, review: !!p.review };
  };
  const others = plan.map((p) => p.py);
  return {
    session: {
      id: s.id, daily: !!s.daily, level: s.level, lastParagraph: s.last_paragraph, dwell: safeJSON(s.dwell, []), activeMs: s.active_ms,
      answered: answered.map((x) => ({ questionId: x.question_id, correct: !!x.correct, attempt: x.attempt, choice: x.choice })),
      quizDone: quizDone.map((x) => ({ char: x.char, correct: !!x.correct, retryOk: !!x.retry_ok })),
    },
    article: {
      id: a.id, title: a.title, genre: GENRE_NAMES[a.genre] || a.genre, chars: a.char_count,
      paragraphs: paras.map((text, i) => ({ text, py: py[i] || "", audio: audio[i] && audio[i] !== "none" ? `/api/audio/${a.id}/${i}` : null })),
    },
    newChars: plan.filter((p) => !p.review).map(card),
    reviewChars: plan.filter((p) => p.review).map(card),
    purpose: purpose ? { task: purpose.task, questionId: choiceQs[purpose.q]?.id ?? null } : null,
    guess: guess ? { id: guess.id, prompt: guess.prompt, word: guess.word, options: JSON.parse(guess.options), paragraph: guess.evidence } : null,
    questions: choiceQs.map((q) => ({ id: q.id, ability: q.ability, abilityName: ABILITY_NAMES[q.ability], prompt: q.prompt, options: JSON.parse(q.options), evidence: q.evidence })),
    predict: predict ? { id: predict.id, prompt: predict.prompt, options: JSON.parse(predict.options), ...safeJSON(predict.meta, {}) } : null,
    // 回文定位: the evidence paragraph and its neighbours, split into tappable sentences
    locates: locates.map((q) => {
      const at = safeJSON(q.meta, {});
      const shown = [at.para - 1, at.para, at.para + 1].filter((i) => i >= 0 && i < paras.length);
      return { id: q.id, prompt: q.prompt, paras: shown.map((i) => ({ index: i, sentences: splitSentences(paras[i]) })) };
    }),
    sections: sections.map((q) => ({ id: q.id, prompt: q.prompt, options: JSON.parse(q.options), ...safeJSON(q.meta, {}) })),
    // the key points stay on the server: the child retells freely
    // 错题回炉: earlier misses, asked again before today's reading
    review,
    readAloud: has("readaloud"),
    readAloudScored: completed >= READALOUD_SCORE_AFTER,
    retell: retellQ ? { points: JSON.parse(retellQ.options).length, triesLeft: Math.max(0, RETELL_MAX - retells) } : null,
    charQuiz: plan.filter((p) => p.quiz).map((p, i) => ({
      char: p.char, word: gl.get(p.char)?.word || null, review: !!p.review,
      options: pinyinChoices(p.py, others.filter((o) => o !== p.py), i + s.id, validReadings(p.char)),
    })),
    skills,
    settings: { pinyin: settings.pinyin, fontSize: settings.font_size },
    eye: eyeCare(settings, day?.screen_ms || 0),
    maxAttempts: MAX_ATTEMPTS,
  };
}

/**
 * 错题回炉: comprehension questions this child missed first time in the last
 * two weeks (other articles), due again today. Each comes with the paragraph
 * that holds the answer, so it is a short reading of its own.
 */
async function reviewItems(env, today, articleId) {
  const missed = await all(env, `SELECT an.question_id, MAX(s.date) date FROM answers an
      JOIN sessions s ON s.id = an.session_id JOIN questions q ON q.id = an.question_id
    WHERE an.attempt = 1 AND an.correct = 0 AND q.kind = 'choice' AND s.date >= ? AND s.date < ? AND s.article_id <> ?
    GROUP BY an.question_id`, addDays(today, -REVIEW_WINDOW_DAYS), today, articleId);
  if (!missed.length) return [];
  const ids = missed.map((m) => m.question_id);
  const ph = ids.map(() => "?").join(",");
  const reviews = await all(env, `SELECT r.question_id, r.correct, s.date FROM review_answers r JOIN sessions s ON s.id = r.session_id WHERE r.question_id IN (${ph})`, ...ids);
  const due = dueReviews(missed.map((m) => ({
    questionId: m.question_id, date: m.date,
    reviews: reviews.filter((r) => r.question_id === m.question_id).map((r) => ({ date: r.date, correct: r.correct })),
  })), today);
  if (!due.length) return [];
  const qs = await all(env, `SELECT q.id, q.ability, q.prompt, q.options, q.evidence, a.title, a.body FROM questions q JOIN articles a ON a.id = q.article_id
    WHERE q.id IN (${due.map(() => "?").join(",")})`, ...due.map((d) => d.questionId));
  return due.map((d) => qs.find((q) => q.id === d.questionId)).filter(Boolean).map((q) => ({
    id: q.id, ability: q.ability, abilityName: ABILITY_NAMES[q.ability], prompt: q.prompt, options: JSON.parse(q.options),
    title: q.title, passage: q.evidence != null ? paragraphs(q.body)[q.evidence] || null : null,
  }));
}

/** One answer to a 回炉 question: one try per session, then the answer is shown. */
export async function reviewAnswer(env, id, { questionId, choice }) {
  const s = await ownSession(env, id);
  const q = await first(env, "SELECT id, ability, answer, explain FROM questions WHERE id = ? AND kind = 'choice'", questionId);
  if (!q) throw new HttpError(404, "question not found");
  const prev = await first(env, "SELECT correct FROM review_answers WHERE session_id = ? AND question_id = ?", s.id, q.id);
  if (prev) return { correct: !!prev.correct, answer: q.answer, explain: q.explain, already: true };
  const tries = (await first(env, "SELECT COUNT(*) n FROM review_answers WHERE question_id = ?", q.id)).n;
  if (tries >= REVIEW_MAX) throw new HttpError(409, "这道题已经回炉过了");
  const correct = Number(choice) === q.answer ? 1 : 0;
  await run(env, "INSERT INTO review_answers (session_id, question_id, ability, choice, correct) VALUES (?, ?, ?, ?, ?)", s.id, q.id, q.ability, Number(choice), correct);
  return { correct: !!correct, answer: q.answer, explain: q.explain };
}

/**
 * Which characters this session teaches (new for this child) and reviews
 * (due, appearing in this article). Fixed at session start.
 */
async function planChars(env, a, today) {
  const known = await knownSet(env);
  const { teachable } = newCharsFor(a.uniq, known);
  const newOnes = teachList(teachable);
  const dueRows = await all(env, "SELECT char FROM chars WHERE status IN ('seen','familiar') AND due_at <= ? ORDER BY due_at LIMIT 200", today);
  const review = dueRows.map((r) => r.char).filter((ch) => a.uniq.includes(ch) && !newOnes.includes(ch)).slice(0, MAX_QUIZ_REVIEW);
  const glossRows = await all(env, "SELECT char, pinyin FROM glosses WHERE article_id = ?", a.id);
  const gl = new Map(glossRows.map((g) => [g.char, g.pinyin]));
  // the quiz teaches the dictionary reading: 一 yī, 不 bù (not the tone-changed one of a context)
  const BASE_READING = { 一: "yī", 不: "bù" };
  const py = (ch) => BASE_READING[ch] || gl.get(ch) || readingOf(ch);
  return [
    ...newOnes.map((ch, i) => ({ char: ch, py: py(ch), review: false, quiz: i < MAX_QUIZ_NEW })),
    ...review.map((ch) => ({ char: ch, py: py(ch), review: true, quiz: true })),
  ];
}

/** First meeting: new characters enter the archive as 见过 (seen). */
async function meetChars(env, plan, articleId, today) {
  if (!plan.length) return;
  const gl = new Map((await all(env, "SELECT char, word, gloss FROM glosses WHERE article_id = ?", articleId)).map((g) => [g.char, g]));
  await batch(env, plan.map((p) => stmt(env,
    `INSERT INTO chars (char, status, origin, pinyin, gloss, word, first_seen_at, first_article_id, due_at)
     VALUES (?, 'seen', 'reading', ?, ?, ?, ?, ?, ?)
     ON CONFLICT(char) DO UPDATE SET pinyin = COALESCE(chars.pinyin, excluded.pinyin), gloss = COALESCE(chars.gloss, excluded.gloss),
       word = COALESCE(chars.word, excluded.word), first_seen_at = COALESCE(chars.first_seen_at, excluded.first_seen_at),
       first_article_id = COALESCE(chars.first_article_id, excluded.first_article_id), updated_at = datetime('now')`,
    p.char, p.py, gl.get(p.char)?.gloss || null, gl.get(p.char)?.word || null, today, articleId, addDays(today, 1))));
}

async function ownSession(env, id) {
  const s = await first(env, "SELECT * FROM sessions WHERE id = ?", id);
  if (!s) throw new HttpError(404, "session not found");
  return s;
}

/** Autosave: paragraph position, dwell per paragraph, active time, taps, screen time. */
export async function progress(env, id, body) {
  const s = await ownSession(env, id);
  const dwell = safeJSON(s.dwell, []);
  (Array.isArray(body.dwell) ? body.dwell : []).forEach((ms, i) => {
    const v = Math.max(0, Math.min(Number(ms) || 0, 15 * 60000));
    dwell[i] = Math.max(dwell[i] || 0, v);
  });
  const active = Math.max(s.active_ms, Math.min(Number(body.activeMs) || 0, 4 * 3600000));
  const tapped = new Set(s.tapped);
  let taps = s.taps;
  for (const ch of Array.isArray(body.taps) ? body.taps.slice(0, 200) : []) {
    if (typeof ch === "string" && [...ch].length === 1) {
      tapped.add(ch);
      taps++;
    }
  }
  const lastPara = Math.max(s.last_paragraph, Number(body.lastParagraph) || 0);
  await run(env, "UPDATE sessions SET dwell = ?, active_ms = ?, taps = ?, tapped = ?, last_paragraph = ? WHERE id = ?",
    JSON.stringify(dwell.map((x) => x || 0)), active, taps, [...tapped].join(""), lastPara, id);
  const screenDelta = Math.max(0, Math.min(Number(body.screenMsDelta) || 0, 10 * 60000));
  if (screenDelta) {
    await run(env, "INSERT INTO days (date, screen_ms) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET screen_ms = days.screen_ms + excluded.screen_ms", cnDate(), screenDelta);
  }
  const settings = await getSettings(env);
  const day = await first(env, "SELECT screen_ms FROM days WHERE date = ?", cnDate());
  return { ok: true, eye: eyeCare(settings, day?.screen_ms || 0) };
}

/** One answer to a quest question. Wrong answers point back to the text. */
export async function answer(env, id, { questionId, choice }) {
  const s = await ownSession(env, id);
  const q = await first(env, "SELECT * FROM questions WHERE id = ? AND article_id = ?", questionId, s.article_id);
  if (!q) throw new HttpError(404, "question not found");
  const prev = await all(env, "SELECT correct, attempt FROM answers WHERE session_id = ? AND question_id = ? ORDER BY attempt", id, questionId);
  if (q.kind === "predict") {
    // a prediction is not right or wrong: one guess, revealed later in the text
    if (!prev.length) await run(env, "INSERT INTO answers (session_id, question_id, ability, choice, correct, attempt) VALUES (?, ?, 'predict', ?, ?, 1)", id, questionId, Number(choice), Number(choice) === q.answer ? 1 : 0);
    return { recorded: true, answer: q.answer, explain: q.explain, reveal: q.evidence };
  }
  if (prev.some((p) => p.correct)) return { correct: true, already: true, answer: q.answer, explain: q.explain };
  const attempt = prev.length + 1;
  if (attempt > MAX_ATTEMPTS) return { correct: false, done: true, answer: q.answer, explain: q.explain, evidence: q.evidence };
  const correct = Number(choice) === q.answer ? 1 : 0;
  await run(env, "INSERT INTO answers (session_id, question_id, ability, choice, correct, attempt) VALUES (?, ?, ?, ?, ?, ?)", id, questionId, q.ability, Number(choice), correct, attempt);
  const out = { correct: !!correct, attempt, evidence: q.evidence };
  if (correct) out.explain = q.explain;
  if (!correct && attempt === 1) {
    out.hint = q.kind === "locate"
      ? "不是这一句。想想题目问的是什么，再读一读，换一句试试。"
      : q.kind === "section"
        ? "再看看这几段，哪一个说得最全？"
        : q.evidence != null ? `回到第 ${q.evidence + 1} 段找一找，答案就在里面。` : "回到文章里找一找。";
  }
  if (!correct && attempt === 2) out.later = true; // move on; a last try comes after re-reading
  if (!correct && attempt >= MAX_ATTEMPTS) {
    out.answer = q.answer;
    out.explain = q.explain;
  }
  return out;
}

/** Post-reading character quiz: one try per character; drives the SRS. */
export async function charQuiz(env, id, { char, choice, retry = false }) {
  const s = await ownSession(env, id);
  const plan = safeJSON(s.new_chars, []);
  const p = plan.find((x) => x.char === char && x.quiz);
  if (!p) throw new HttpError(400, "char not in this session's quiz");
  const done = await first(env, "SELECT correct, retry_ok FROM char_quiz WHERE session_id = ? AND char = ?", id, char);
  if (done) {
    // second look after re-meeting the card: counts for today's gate only, the SRS keeps the first answer
    if (retry && !done.correct && !done.retry_ok) {
      const ok = String(choice) === p.py ? 1 : 0;
      await run(env, "UPDATE char_quiz SET retry_ok = ? WHERE session_id = ? AND char = ?", ok, id, char);
      return { correct: !!ok, pinyin: p.py, retry: true };
    }
    return { correct: !!done.correct, pinyin: p.py, already: true };
  }
  const correct = String(choice) === p.py ? 1 : 0;
  await run(env, "INSERT INTO char_quiz (session_id, char, correct, review) VALUES (?, ?, ?, ?)", id, char, correct, p.review ? 1 : 0);
  await applySrs(env, char, !!correct, s.article_id, p.py);
  return { correct: !!correct, pinyin: p.py, status: (await first(env, "SELECT status FROM chars WHERE char = ?", char))?.status };
}

async function applySrs(env, char, correct, articleId, py) {
  const today = cnDate();
  const row = await first(env, "SELECT * FROM chars WHERE char = ?", char);
  const cur = row
    ? { status: row.status, correctArticles: safeJSON(row.correct_articles, []), lapses: row.lapses, masteredAt: row.mastered_at }
    : { status: "seen", correctArticles: [], lapses: 0 };
  const next = srsUpdate(cur, correct, articleId, today);
  await run(env, `INSERT INTO chars (char, status, origin, pinyin, first_seen_at, first_article_id, correct_articles, lapses, due_at, mastered_at)
      VALUES (?, ?, 'reading', ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(char) DO UPDATE SET status = excluded.status, correct_articles = excluded.correct_articles, lapses = excluded.lapses,
        due_at = excluded.due_at, mastered_at = excluded.mastered_at,
        origin = CASE WHEN chars.origin IN ('assessment','inferred') AND excluded.status <> chars.status THEN 'reading' ELSE chars.origin END,
        updated_at = datetime('now')`,
    char, next.status, py, today, articleId, JSON.stringify(next.correctArticles), next.lapses, next.dueAt, next.masteredAt || null);
}

/** Judge completion (§10) and hand out rewards (§8). Idempotent for rewards. */
export async function finish(env, id) {
  const s = await ownSession(env, id);
  const a = await first(env, "SELECT id, body, char_count, genre FROM articles WHERE id = ?", s.article_id);
  // predictions are a reading habit, not a test: they never count toward completion
  const answers = await all(env, "SELECT a.question_id, a.ability, a.correct, a.attempt, q.evidence FROM answers a JOIN questions q ON q.id = a.question_id WHERE a.session_id = ? AND q.kind <> 'predict'", id);
  const quiz = await all(env, "SELECT correct, retry_ok FROM char_quiz WHERE session_id = ?", id);
  const v = verdict({
    paras: paragraphs(a.body).map(countHan),
    dwell: safeJSON(s.dwell, []),
    activeMs: s.active_ms,
    answers: answers.map((x) => ({ questionId: x.question_id, ability: x.ability, correct: x.correct, attempt: x.attempt, evidence: x.evidence })),
    charQuiz: quiz.map((q) => ({ correct: q.correct || q.retry_ok })),
    fails: safeJSON(s.verdict, null)?.fails || 0,
  });
  const charFirstAll = quiz.length > 0 && quiz.every((q) => q.correct);
  v.charFirstOk = quiz.filter((q) => q.correct).length; // for the parent: first try, before re-meeting
  const wasCompleted = s.level >= 2;
  const level = Math.max(s.level, v.level);
  await run(env, "UPDATE sessions SET level = ?, accuracy = ?, char_ok = ?, char_total = ?, verdict = ?, finished_at = COALESCE(finished_at, datetime('now')) WHERE id = ?",
    level, v.accuracy, v.charOk, v.charTotal, JSON.stringify(v), id);

  await applyTaps(env, s);
  if (!v.completed || wasCompleted) {
    return { verdict: v, rewards: null, alreadyCompleted: wasCompleted };
  }

  // ---------------------------------------------------------------- rewards
  const today = cnDate();
  const settings = await getSettings(env);
  const gains = [];
  // 找回答案 / 读完也算数: through, with half the base bones
  const soft = v.tier === "found" || v.tier === "effort";
  const base = (n) => (soft ? Math.ceil(n / 2) : n);
  const tierNote = v.tier === "found" ? "（找回答案）" : v.tier === "effort" ? "（读完也算数）" : "";
  if (s.daily) {
    await run(env, "INSERT INTO days (date, completed) VALUES (?, 1) ON CONFLICT(date) DO UPDATE SET completed = 1", today);
    gains.push({ amount: base(BONES.daily), reason: "完成今日阅读" + tierNote });
  } else {
    const day = await first(env, "SELECT extra_bonus FROM days WHERE date = ?", today);
    if ((day?.extra_bonus || 0) < BONES.extraCapPerDay) {
      await run(env, "INSERT INTO days (date, extra_bonus) VALUES (?, 1) ON CONFLICT(date) DO UPDATE SET extra_bonus = days.extra_bonus + 1", today);
      gains.push({ amount: base(BONES.extra), reason: "多读一篇" + tierNote });
    }
  }
  if (v.accuracy >= 0.9) gains.push({ amount: BONES.accuracy, reason: "闯关题几乎全对" });
  if (charFirstAll) gains.push({ amount: BONES.charQuiz, reason: "生字小测全对" });
  const bones = gains.reduce((x, g) => x + g.amount, 0);
  await batch(env, gains.map((g) => stmt(env, "INSERT INTO ledger (amount, reason, ref) VALUES (?, ?, ?)", g.amount, g.reason, `session:${id}`)));
  await run(env, "UPDATE sessions SET bones = ? WHERE id = ?", bones, id);

  // surprise chest
  const owned = new Set((await all(env, "SELECT code FROM awards")).map((r) => r.code));
  const chest = openChest(id * 7919 + Date.now() % 1000, owned);
  if (chest.kind === "accessory") await run(env, "INSERT OR IGNORE INTO awards (code, kind, title) VALUES (?, 'accessory', ?)", chest.code, chest.title);

  // streak, freezes, medals, puppy, map
  const st = await streakInfo(env, today, settings);
  if (s.daily && st.streak > 0 && st.streak % 7 === 0 && settings.freeze_earned_at !== st.streak && settings.freezes < MAX_FREEZES) {
    await setSetting(env, "freezes", settings.freezes + 1);
    await setSetting(env, "freeze_earned_at", st.streak);
    st.freezes = settings.freezes + 1;
    st.freezeEarned = true;
  }
  const completed = await completedCount(env);
  const mastered = (await first(env, "SELECT COUNT(*) n FROM chars WHERE origin IN ('reading','textbook') AND status = 'mastered'")).n;
  const charsRead = (await first(env, "SELECT COALESCE(SUM(a.char_count), 0) n FROM sessions s JOIN articles a ON a.id = s.article_id WHERE s.level >= 2")).n;
  const newMedals = medalsFor({ streak: st.streak, completed, mastered, charsRead }).filter((m) => !owned.has(m.code));
  await batch(env, newMedals.map((m) => stmt(env, "INSERT OR IGNORE INTO awards (code, kind, title) VALUES (?, 'medal', ?)", m.code, m.title)));

  // known-set snapshot + adapt tomorrow's difficulty
  await snapshot(env, today);
  const recent = await all(env, "SELECT accuracy FROM sessions WHERE level >= 1 AND accuracy IS NOT NULL ORDER BY id DESC LIMIT 3");
  const target = adaptTarget(settings.target_new, recent.map((r) => r.accuracy));
  if (target !== settings.target_new) await setSetting(env, "target_new", target);

  const map = mapState(await genreCounts(env));
  const region = map.regions.find((r) => r.key === regionOf(a.genre).key);
  const before = puppyStage(completed - 1);
  const puppy = puppyStage(completed);
  return {
    verdict: v,
    rewards: {
      bones: gains, total: bones, balance: await bonesBalance(env), chest, medals: newMedals,
      streak: st.streak, freezes: st.freezes, freezeEarned: !!st.freezeEarned,
      puppy, puppyGrew: puppy.key !== before.key, map: { region: region.name, icon: region.icon, count: region.count, firstVisit: region.count === 1, tower: map.tower }, completed,
    },
  };
}

/**
 * 语音复述 (§7): after completing, the child retells the story aloud.
 * Whisper → simplified text → Qwen checks the key points by meaning.
 * The only live model call on the reading path, capped per session.
 */
export async function retell(env, id, request) {
  const s = await ownSession(env, id);
  if (s.level < 2) throw new HttpError(409, "先完成今天的阅读，再来复述");
  const q = await first(env, "SELECT options FROM questions WHERE article_id = ? AND kind = 'retell'", s.article_id);
  if (!q) throw new HttpError(404, "这篇文章没有复述要点");
  const tries = (await first(env, "SELECT COUNT(*) n FROM retells WHERE session_id = ?", id)).n;
  if (tries >= RETELL_MAX) throw new HttpError(429, "今天这篇已经讲过两次啦，明天再讲新故事吧");
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length < 2000) throw new HttpError(400, "录音太短了，再讲一遍吧");
  if (bytes.length > 6 * 1024 * 1024) throw new HttpError(413, "录音太长了，讲两分钟以内就好");
  const tired = () => new HttpError(503, "小猎犬今天听了太多故事，有点累了，明天再讲给它听吧");
  let transcript;
  try {
    transcript = await transcribe(env, bytes);
  } catch (e) {
    if (isQuotaError(e)) throw tired();
    throw e;
  }
  if (countHan(transcript) < 8) return { tooShort: true, transcript, message: "小猎犬没听清楚，靠近一点、大声一点再讲一遍？" };

  const a = await first(env, "SELECT title FROM articles WHERE id = ?", s.article_id);
  const points = JSON.parse(q.options);
  let r;
  try {
    r = await assessRetell(env, { title: a.title, points, transcript });
  } catch (e) {
    if (isQuotaError(e)) throw tired();
    throw e;
  }
  await run(env, "INSERT INTO retells (session_id, transcript, covered, total, feedback, tip) VALUES (?, ?, ?, ?, ?, ?)",
    id, transcript, JSON.stringify(r.covered), points.length, r.feedback, r.tip);

  const passed = r.covered.length / points.length >= RETELL_PASS;
  let bones = 0;
  if (passed && s.level < 3) {
    await run(env, "UPDATE sessions SET level = 3 WHERE id = ?", id);
    await run(env, "INSERT INTO ledger (amount, reason, ref) VALUES (?, '完成复述', ?)", BONES.retell, `retell:${id}`);
    await run(env, "UPDATE sessions SET bones = bones + ? WHERE id = ?", BONES.retell, id);
    bones = BONES.retell;
  }
  return {
    transcript, feedback: r.feedback, tip: r.tip,
    covered: r.covered, missed: points.filter((p) => !r.covered.includes(p)),
    passed, level: passed ? 3 : s.level, bones, triesLeft: RETELL_MAX - tries - 1,
  };
}

/**
 * 朗读流利度 (phase 3): one paragraph read aloud → speech recognition →
 * toneless-pinyin comparison with the paragraph (homophones are not errors).
 */
export async function fluency(env, id, request) {
  const s = await ownSession(env, id);
  const url = new URL(request.url);
  const para = Number(url.searchParams.get("para"));
  const ms = Math.max(1000, Math.min(Number(url.searchParams.get("ms")) || 0, 5 * 60000));
  const a = await first(env, "SELECT body, pinyin FROM articles WHERE id = ?", s.article_id);
  const paras = paragraphs(a.body);
  if (!(Number.isInteger(para) && para >= 0 && para < paras.length)) throw new HttpError(400, "bad paragraph");
  const today = cnDate();
  const used = (await first(env, "SELECT COUNT(*) n FROM fluency_reads WHERE at >= ?", `${addDays(today, -1)} 16:00:00`)).n; // since 00:00 Shanghai
  if (used >= FLUENCY_DAILY) throw new HttpError(429, "今天已经读了好多段啦，嗓子休息一下，明天再读给小猎犬听");
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length < 2000) throw new HttpError(400, "录音太短了，再读一遍吧");
  if (bytes.length > 6 * 1024 * 1024) throw new HttpError(413, "录音太长了");
  let transcript;
  try {
    transcript = await transcribe(env, bytes);
  } catch (e) {
    if (isQuotaError(e)) throw new HttpError(503, "小猎犬今天听了太多，有点累了，明天再读给它听吧");
    throw e;
  }
  const py = safeJSON(a.pinyin, [])[para] || "";
  const r = compareReading(paras[para], py, transcript, ms);
  if (countHan(transcript) < Math.min(6, r.total / 3)) return { tooShort: true, message: "小猎犬没听清，靠近一点、大声一点再读一遍？" };
  await run(env, "INSERT INTO fluency_reads (session_id, para, accuracy, cpm, missed, transcript) VALUES (?, ?, ?, ?, ?, ?)",
    id, para, r.accuracy, r.cpm, JSON.stringify(r.practise), transcript);
  return { ...r, transcript, left: FLUENCY_DAILY - used - 1 };
}

/** Tapping a character for help is a gentle signal (§5 点读回退): review it sooner. */
async function applyTaps(env, s) {
  const chars = [...(s.tapped || "")];
  if (!chars.length) return;
  const tomorrow = addDays(cnDate(), 1);
  const rows = await all(env, `SELECT char, status FROM chars WHERE char IN (${chars.map(() => "?").join(",")})`, ...chars);
  await batch(env, rows.filter((r) => r.status !== "seen").map((r) => stmt(env,
    "UPDATE chars SET status = CASE WHEN status = 'mastered' THEN 'familiar' ELSE status END, mastered_at = CASE WHEN status = 'mastered' THEN NULL ELSE mastered_at END, due_at = ?, updated_at = datetime('now') WHERE char = ?",
    tomorrow, r.char)));
}

export async function snapshot(env, today) {
  const c = await first(env, `SELECT SUM(CASE WHEN status IN ('familiar','mastered') THEN 1 ELSE 0 END) known,
    SUM(CASE WHEN status = 'mastered' THEN 1 ELSE 0 END) mastered FROM chars`);
  await run(env, "INSERT INTO snapshots (date, known, mastered) VALUES (?, ?, ?) ON CONFLICT(date) DO UPDATE SET known = excluded.known, mastered = excluded.mastered", today, c?.known || 0, c?.mastered || 0);
}

// ================================================================ assessment
/** One level of the baseline test: chars + 3 pinyin options (+ "不认识"). */
export function assessmentLevel(level, seed) {
  if (!(level >= 0 && level < ASSESS_LEVELS)) throw new HttpError(400, "bad level");
  const chars = sampleLevel(level, ASSESS_PER_LEVEL, seed);
  const readings = chars.map((ch) => readingOf(ch));
  return {
    level, levels: ASSESS_LEVELS, name: LEVEL_NAMES[level],
    // `a` lets the client apply the stop rule between levels; the server re-grades on finish
    items: chars.map((ch, i) => {
      const options = pinyinChoices(readings[i], readings.filter((_, j) => j !== i), seed + i, validReadings(ch));
      return { char: ch, options, a: options.indexOf(readings[i]) };
    }),
  };
}

function validReadings(ch) {
  return new Set(pinyinPro(ch, { multiple: true, type: "array" }));
}

export async function finishAssessment(env, { results }) {
  if (!Array.isArray(results) || !results.length) throw new HttpError(400, "no results");
  const graded = results.slice(0, ASSESS_LEVELS * ASSESS_PER_LEVEL).map((r) => ({
    level: Number(r.level), char: String(r.char), correct: r.choice != null && validReadings(String(r.char)).has(String(r.choice)),
  }));
  const { levels, estimate, known, reached } = scoreAssessment(graded);
  // replace earlier assessment-derived rows; keep what reading has taught
  await run(env, "DELETE FROM chars WHERE origin IN ('assessment','inferred')");
  const existing = new Set((await all(env, "SELECT char FROM chars")).map((r) => r.char));
  const rows = [...known].filter(([ch]) => !existing.has(ch));
  await batch(env, rows.map(([ch, origin]) => stmt(env, "INSERT INTO chars (char, status, origin) VALUES (?, 'familiar', ?)", ch, origin)));
  await run(env, "INSERT INTO assessments (estimate, detail) VALUES (?, ?)", estimate, JSON.stringify(levels));
  await setSetting(env, "assessment_requested", false);
  // a fresh known set changes what is "new": re-pick today
  await run(env, "DELETE FROM daily_pick WHERE date = ? AND NOT EXISTS (SELECT 1 FROM sessions WHERE date = ? AND daily = 1)", cnDate(), cnDate());
  await snapshot(env, cnDate());
  return { estimate, reached, levels, known: known.size };
}

// ================================================================ archive
/** "这个字我在哪儿见过？" — archive card + the stories it appeared in. */
export async function charCard(env, ch) {
  if ([...ch].length !== 1) throw new HttpError(400, "one character");
  const row = await first(env, "SELECT * FROM chars WHERE char = ?", ch);
  const enc = await all(env, "SELECT e.article_id, e.occurrences, a.title, a.body FROM char_encounters e JOIN articles a ON a.id = e.article_id WHERE e.char = ? LIMIT 200", ch);
  const readIds = enc.length
    ? new Set((await all(env, `SELECT DISTINCT article_id FROM sessions WHERE article_id IN (${enc.map(() => "?").join(",")})`, ...enc.map((e) => e.article_id))).map((r) => r.article_id))
    : new Set();
  const seenIn = enc.filter((e) => readIds.has(e.article_id)).map((e) => {
    const i = e.body.indexOf(ch);
    return { articleId: e.article_id, title: e.title, occurrences: e.occurrences, snippet: e.body.slice(Math.max(0, i - 12), i + 13).replace(/\n/g, " ") };
  });
  return {
    char: ch,
    pinyin: row?.pinyin || readingOf(ch),
    status: row?.status || "unseen",
    gloss: row?.gloss || null,
    word: row?.word || null,
    firstSeenAt: row?.first_seen_at || null,
    masteredAt: row?.mastered_at || null,
    correctArticles: safeJSON(row?.correct_articles, []).length,
    textbook: textbookInfo(ch), // 统编版: which volume teaches recognising / writing it
    seenIn,
    moreInLibrary: enc.length - seenIn.length,
  };
}

/** 生字图鉴: characters met through reading, with where they came from. */
export async function collection(env) {
  const rows = await all(env, "SELECT c.char, c.status, c.pinyin, c.gloss, c.word, c.first_seen_at, c.mastered_at, c.first_article_id, a.title FROM chars c LEFT JOIN articles a ON a.id = c.first_article_id WHERE c.origin = 'reading' ORDER BY c.first_seen_at DESC LIMIT 2000");
  const medals = await all(env, "SELECT code, title, at FROM awards WHERE kind = 'medal' ORDER BY at");
  const order = { mastered: 0, familiar: 1, seen: 2 };
  return {
    cards: rows.sort((x, y) => order[x.status] - order[y.status]).map((r) => ({
      char: r.char, status: r.status, pinyin: r.pinyin, gloss: r.gloss, word: r.word,
      from: r.title, fromId: r.first_article_id, firstSeenAt: r.first_seen_at, masteredAt: r.mastered_at,
    })),
    medals,
  };
}

/** Read an already-read article again (context jump from the archive). */
export async function rereadArticle(env, id) {
  const read = await first(env, "SELECT 1 FROM sessions WHERE article_id = ? LIMIT 1", id);
  if (!read) throw new HttpError(403, "还没读过这篇");
  const a = await first(env, "SELECT id, title, body, pinyin FROM articles WHERE id = ?", id);
  const py = safeJSON(a.pinyin, []);
  return { id: a.id, title: a.title, paragraphs: paragraphs(a.body).map((text, i) => ({ text, py: py[i] || "" })) };
}

export function safeJSON(s, dflt) {
  if (s == null || s === "") return dflt;
  try { return JSON.parse(s); } catch { return dflt; }
}
