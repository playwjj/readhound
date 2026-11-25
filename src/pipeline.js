// Ingest pipeline (§4–§6): one article, one stage per step, so every
// invocation stays small (Worker CPU limits) and failures retry per stage.
//   (generate →) metrics → screen → pinyin → polyphones → encounters → glosses → questions → skills → audio → ready
import { all, first, run, stmt, batch, getSettings, setSetting, knownSet } from "./db.js";
import { normalise, paragraphs, articleMetrics, hardScreen, rankOf, CORE_RANK, MAX_RANK, VOLUME_END, LEVEL_ORDER, newCharsFor, charCounts, countHan } from "./lib/text.js";
import { annotate, readingAt, readingOf, polyphonesIn, applyFixes } from "./lib/pinyin.js";
import { screenArticle, glossChars, makeQuestions, makeSkills, tts, checkPolyphones, writeStory, rewriteStory, GENRES, isQuotaError, utcDay,
  validateScreen, validateGlosses, validateQuestions, validateSkills, NARRATIVE } from "./lib/ai.js";
import { cnDate, addDays } from "./lib/logic.js";
import { currentUnit } from "./curriculum.js";

export const STAGES = ["generate", "metrics", "screen", "pinyin", "polyphones", "encounters", "glosses", "questions", "skills", "audio"];
/** Stages whose failure must not cost the article: they are skipped after the last attempt. */
const OPTIONAL = new Set(["skills", "audio"]);
const MAX_ATTEMPTS = 3;
const GLOSS_CAP = 24;

/** Queue a new article. Returns {id} or {duplicate}. */
export async function enqueue(env, { title, body, genre, source, kind = "family_book", series = null, part = null, prepared = null }) {
  title = normalise(String(title || "")).replace(/\n/g, " ").trim().slice(0, 80);
  body = normalise(body);
  if (!title || !body) throw new Error("标题和正文都不能为空");
  const dup = await first(env, "SELECT id FROM articles WHERE title = ? AND length(body) = ?", title, body.length);
  if (dup) return { duplicate: dup.id };
  let sourceId = null;
  if (source) {
    await run(env, "INSERT OR IGNORE INTO sources (name, kind) VALUES (?, ?)", source, kind);
    sourceId = (await first(env, "SELECT id FROM sources WHERE name = ?", source)).id;
  }
  const r = await run(env, "INSERT INTO articles (source_id, title, body, genre, status, stage, series, part, prepared) VALUES (?, ?, ?, ?, 'queued', 'metrics', ?, ?, ?)",
    sourceId, title, body, genre || null, series, part, prepared ? JSON.stringify(prepared) : null);
  return { id: r.meta.last_row_id };
}

/** Next article with pending work (index: status). Prepared ones first: they need no AI. */
export async function nextPending(env) {
  return first(env, "SELECT * FROM articles WHERE status IN ('queued','processing') ORDER BY (prepared IS NULL), id LIMIT 1");
}

/**
 * Hand-prepared content for a stage, if any (see scripts/prepare.mjs). The
 * same validators as for model output apply, so it lands in the same shape.
 */
function preparedFor(a, stage) {
  if (!a.prepared) return null;
  try {
    return JSON.parse(a.prepared)[stage] ?? null;
  } catch {
    return null;
  }
}

/** Check a prepared block before it is queued (errors name the stage). */
export function checkPrepared(body, genre, p) {
  if (!p || typeof p !== "object") throw new Error("prepared: expected an object");
  const at = (stage, fn) => {
    if (p[stage] == null) return;
    try { fn(p[stage]); } catch (e) { throw new Error(`prepared.${stage}: ${e.message}`); }
  };
  at("screen", (x) => validateScreen(x));
  at("glosses", (x) => validateGlosses(x, body, x.map((g) => g.char)));
  at("questions", (x) => validateQuestions(x, body));
  at("skills", (x) => validateSkills(x, body, NARRATIVE.has(genre)));
  at("polyphones", (x) => {
    const paras = paragraphs(body);
    for (const [k, v] of Object.entries(x)) {
      const [pi, idx] = k.split(":").map(Number);
      if (!paras[pi] || !(idx >= 0) || !/^[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]+$/.test(v)) throw new Error(`bad entry ${k}=${v}`);
    }
  });
}

/** Run one stage of one article. Returns a short log line. */
/** Stages that call a model (the rest is code). */
const AI_STAGES = new Set(["generate", "screen", "polyphones", "glosses", "questions", "skills"]);
export const INGEST_PURPOSES = ["screen", "glosses", "questions", "skills", "polyphones", "story"];
const nextUtcMidnight = () => new Date(Math.floor(Date.now() / 86400000 + 1) * 86400000).toISOString();
const PAUSE_TEXT = { quota: "AI 今日免费额度已用完", budget: "今日入库的 AI 调用已到上限" };

/** {until, reason} while the pipeline waits for the next UTC day; null when running. */
export async function aiPausedUntil(env) {
  const s = await getSettings(env);
  return s.ai_paused_until && Date.now() < Date.parse(s.ai_paused_until) ? { until: s.ai_paused_until, reason: s.ai_paused_reason || "quota" } : null;
}
async function pause(env, reason) {
  const until = nextUtcMidnight();
  await setSetting(env, "ai_paused_until", until);
  await setSetting(env, "ai_paused_reason", reason);
  return until;
}
export const PAUSED = "⏸";

export async function ingestCallsToday(env) {
  const r = await first(env, `SELECT COALESCE(SUM(calls), 0) n FROM ai_usage WHERE day = ? AND purpose IN (${INGEST_PURPOSES.map(() => "?").join(",")})`, utcDay(), ...INGEST_PURPOSES);
  return r.n;
}

export async function step(env, article) {
  const a = article || (await nextPending(env));
  if (!a) return null;
  const stage = a.stage;
  // a stage with hand-prepared content calls no model: no pause, no budget
  if (AI_STAGES.has(stage) && preparedFor(a, stage) == null) {
    const paused = await aiPausedUntil(env);
    if (paused) return `${PAUSED} ${PAUSE_TEXT[paused.reason]}，${paused.until} 后继续`;
    const limit = (await getSettings(env)).ai_daily_calls;
    if (limit > 0 && (await ingestCallsToday(env)) >= limit) {
      const until = await pause(env, "budget");
      return `${PAUSED} ${PAUSE_TEXT.budget}（${limit} 次），${until} 后继续`;
    }
  }
  try {
    const done = await STAGE_FN[stage](env, a);
    if (done === "stay") return `#${a.id} ${stage} (continuing)`;
    if (done === "stop") return `#${a.id} ${stage} → stopped`;
    const next = STAGES[STAGES.indexOf(stage) + 1];
    if (next) await run(env, "UPDATE articles SET status = 'processing', stage = ?, attempts = 0, last_error = NULL WHERE id = ?", next, a.id);
    else await run(env, "UPDATE articles SET status = CASE WHEN age_fit = 'flagged' THEN 'flagged' ELSE 'ready' END, stage = 'done', ready_at = datetime('now'), attempts = 0, last_error = NULL WHERE id = ?", a.id);
    return `#${a.id} ${stage} ok`;
  } catch (e) {
    const msg = String(e && (e.message || e)).slice(0, 300);
    if (isQuotaError(e)) {
      // not the article's fault: pause everything until the allocation resets (00:00 UTC)
      const until = await pause(env, "quota");
      await run(env, "UPDATE articles SET last_error = ? WHERE id = ?", `等待 AI 额度重置（${until}）`, a.id);
      return `${PAUSED} #${a.id} ${stage}: AI 今日额度已用完，${until} 后继续`;
    }
    const attempts = (a.attempts || 0) + 1;
    console.error(`[pipeline] #${a.id} ${stage} failed (${attempts}):`, e && (e.stack || msg));
    if (attempts >= MAX_ATTEMPTS) {
      if (OPTIONAL.has(stage)) {
        // optional stage: skip it (no phase-2 skill questions / device voice reads)
        const next = STAGES[STAGES.indexOf(stage) + 1];
        if (next) await run(env, "UPDATE articles SET status = 'processing', stage = ?, attempts = 0, last_error = ? WHERE id = ?", next, `${stage} skipped: ${msg}`, a.id);
        else await run(env, "UPDATE articles SET status = CASE WHEN age_fit = 'flagged' THEN 'flagged' ELSE 'ready' END, stage = 'done', ready_at = datetime('now'), last_error = ? WHERE id = ?", `${stage} skipped: ${msg}`, a.id);
      } else {
        await run(env, "UPDATE articles SET status = 'rejected', reject_reason = ?, attempts = ?, last_error = ? WHERE id = ?", `处理失败（${stage}）`, attempts, msg, a.id);
      }
    } else {
      await run(env, "UPDATE articles SET attempts = ?, last_error = ? WHERE id = ?", attempts, msg, a.id);
    }
    return `#${a.id} ${stage} failed: ${msg}`;
  }
}

/** Run steps until the time budget is used or the queue is empty. */
export async function drain(env, budgetMs = 60000, maxSteps = 60) {
  const t0 = Date.now();
  const log = [];
  for (let i = 0; i < maxSteps && Date.now() - t0 < budgetMs; i++) {
    const line = await step(env);
    if (!line) break;
    log.push(line);
    if (line.startsWith(PAUSED)) break;
  }
  return log;
}

const STAGE_FN = {
  /**
   * AI-generated story (§11): write → count the characters this child does
   * not know (beyond the chosen targets) → ask for simpler wording → count
   * again; at most two rewrites, the best draft wins. Then the usual stages.
   */
  async generate(env, a) {
    const spec = JSON.parse(a.gen_spec);
    // targets are chosen now, not when queued: a batch of stories would otherwise teach one set of characters
    spec.targets = await storyTargets(env);
    const known = await knownSet(env);
    const allowed = new Set([...spec.targets, ...(spec.hero?.name || "")]);
    const rounds = [];
    let story = await writeStory(env, spec);
    let best = null;
    for (let round = 0; round < 3; round++) {
      const check = checkStory(story, known, allowed);
      rounds.push({ len: check.len, extra: check.extra.length, hard: check.extra.slice(0, 12).join("") });
      if (!best || check.score < best.check.score) best = { story, check };
      // before the baseline test every character counts as unknown: rewriting cannot help
      if (check.ok || round === 2 || known.size < 300) break;
      story = await rewriteStory(env, story, check.extra.slice(0, 15), check.len);
    }
    const report = { ...spec, rounds, targetsUsed: spec.targets.filter((c) => best.story.body.includes(c)) };
    const title = spec.retell || best.story.title; // a retold classic keeps its own name
    await run(env, "UPDATE articles SET title = ?, body = ?, gen_spec = ? WHERE id = ?", title, best.story.body, JSON.stringify(report), a.id);
  },

  async metrics(env, a) {
    const s = await getSettings(env);
    const m = articleMetrics(a.body);
    const why = hardScreen(m, s.params);
    await run(env, `UPDATE articles SET char_count = ?, unique_chars = ?, uniq = ?, coverage = ?, rare_density = ?,
      avg_sentence_len = ?, max_sentence_len = ?, difficulty = ? WHERE id = ?`,
      m.charCount, m.uniqueChars, m.uniq, m.coverage, m.rareDensity, m.avgSentenceLen, m.maxSentenceLen, m.difficulty, a.id);
    if (why.length && !a.reject_reason?.startsWith("家长放行")) {
      await run(env, "UPDATE articles SET status = 'rejected', reject_reason = ? WHERE id = ?", why.join("；"), a.id);
      return "stop";
    }
  },

  async screen(env, a) {
    const s = await getSettings(env);
    const p = preparedFor(a, "screen");
    const r = p ? validateScreen(p) : await screenArticle(env, { title: a.title, body: a.body, interests: s.interests });
    await run(env, "UPDATE articles SET age_fit = ?, genre = COALESCE(genre, ?), tags = ?, ai_note = ?, reject_reason = ? WHERE id = ?",
      r.ageFit, r.genre, JSON.stringify(r.tags), r.note, r.ageFit === "flagged" ? `适龄性存疑：${r.reason}` : null, a.id);
  },

  // a few paragraphs per step: keeps each invocation inside the free plan's CPU budget
  async pinyin(env, a) {
    const paras = paragraphs(a.body);
    const py = a.pinyin ? JSON.parse(a.pinyin) : [];
    const end = Math.min(paras.length, py.length + 4);
    for (let i = py.length; i < end; i++) py.push(annotate(paras[i]));
    await run(env, "UPDATE articles SET pinyin = ? WHERE id = ?", JSON.stringify(py), a.id);
    if (py.length < paras.length) return "stay";
  },

  /** Qwen checks the readings of polyphonic characters (constrained to the candidates); parent fixes win. */
  async polyphones(env, a) {
    const paras = paragraphs(a.body);
    const py = JSON.parse(a.pinyin).map((x) => x.split(" "));
    const items = [];
    paras.forEach((p, pi) => polyphonesIn(p).forEach((it) => items.push({ ...it, pi })));
    let fixed = 0;
    const prepared = preparedFor(a, "polyphones");
    if (prepared) {
      // hand-checked readings: {"<paragraph>:<han index>": reading}
      for (const [k, v] of Object.entries(prepared)) {
        const [pi, idx] = k.split(":").map(Number);
        if (py[pi] && idx < py[pi].length && py[pi][idx] !== v) {
          py[pi][idx] = v;
          fixed++;
        }
      }
    } else {
      // one model call per article; long articles: the first 60 occurrences
      const picked = items.slice(0, 60);
      const answers = await checkPolyphones(env, picked);
      picked.forEach((it, i) => {
        if (answers[i] && answers[i] !== py[it.pi][it.index]) {
          py[it.pi][it.index] = answers[i];
          fixed++;
        }
      });
    }
    const s = await getSettings(env);
    const out = paras.map((p, i) => applyFixes(p, py[i].join(" "), s.pinyin_fixes));
    await run(env, "UPDATE articles SET pinyin = ?, polyphones_fixed = ? WHERE id = ?", JSON.stringify(out), fixed, a.id);
  },

  async encounters(env, a) {
    const counts = new Map();
    for (const ch of a.body) if (a.uniq.includes(ch) && rankOf(ch) > CORE_RANK) counts.set(ch, (counts.get(ch) || 0) + 1);
    await run(env, "DELETE FROM char_encounters WHERE article_id = ?", a.id);
    await batch(env, [...counts].map(([ch, n]) => stmt(env, "INSERT INTO char_encounters (char, article_id, occurrences) VALUES (?, ?, ?)", ch, a.id, n)));
  },

  async glosses(env, a) {
    const prepared = preparedFor(a, "glosses");
    if (prepared) {
      const chars = prepared.map((g) => g.char);
      return storeGlosses(env, a, chars, validateGlosses(prepared, a.body, chars));
    }
    const known = await knownSet(env);
    const chars = glossCandidates(a.uniq, known);
    await ensureGlosses(env, a, chars);
  },

  async questions(env, a) {
    const known = await knownSet(env);
    const { teachable } = newCharsFor(a.uniq, known);
    const guessChars = (teachable.length ? teachable : glossCandidates(a.uniq, known)).slice(0, 8);
    const p = preparedFor(a, "questions");
    const q = p ? validateQuestions(p, a.body) : await makeQuestions(env, { title: a.title, body: a.body, guessChars });
    const list = [...q.questions];
    if (q.guess) list.push(q.guess);
    await run(env, "DELETE FROM questions WHERE article_id = ? AND kind IN ('choice','guess')", a.id);
    await batch(env, list.map((x, i) => stmt(env,
      "INSERT INTO questions (article_id, ord, kind, ability, prompt, options, answer, evidence, word, explain) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      a.id, i, x.kind, x.ability, x.prompt, JSON.stringify(x.options), x.answer, x.evidence, x.word || null, x.explain || null)));
    await run(env, "UPDATE articles SET purpose = ? WHERE id = ?", q.purpose ? JSON.stringify(q.purpose) : null, a.id);
  },

  /** Phase-2 skills: prediction (stories only), evidence sentence, section summaries. */
  async skills(env, a) {
    const p = preparedFor(a, "skills");
    const list = p ? validateSkills(p, a.body, NARRATIVE.has(a.genre)) : await makeSkills(env, { title: a.title, body: a.body, genre: a.genre });
    await run(env, "DELETE FROM questions WHERE article_id = ? AND kind IN ('predict','locate','section','retell')", a.id);
    await batch(env, list.map((x, i) => stmt(env,
      "INSERT INTO questions (article_id, ord, kind, ability, prompt, options, answer, evidence, explain, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      a.id, 100 + i, x.kind, x.ability, x.prompt, JSON.stringify(x.options), x.answer, x.evidence, x.explain || null, JSON.stringify(x.meta))));
  },

  async audio(env, a) {
    const s = await getSettings(env);
    if (!s.audio || !env.AUDIO || !env.TTS_MODEL) return;
    const paras = paragraphs(a.body);
    const keys = a.audio ? JSON.parse(a.audio) : paras.map(() => null);
    let did = 0;
    for (let i = 0; i < paras.length && did < 3; i++) {
      if (keys[i]) continue;
      const bytes = await tts(env, paras[i]);
      if (!bytes) {
        keys[i] = "none";
      } else {
        const key = `audio/${a.id}/${i}.mp3`;
        await env.AUDIO.put(key, bytes, { httpMetadata: { contentType: "audio/mpeg" } });
        keys[i] = key;
      }
      did++;
    }
    await run(env, "UPDATE articles SET audio = ? WHERE id = ?", JSON.stringify(keys), a.id);
    if (keys.some((k) => !k)) return "stay";
  },
};

/** How far a draft is from "~5 new characters, 600-800 chars" for this child. */
export function checkStory(story, known, allowed) {
  const counts = charCounts(story.body);
  const extra = [...counts.keys()].filter((ch) => !known.has(ch) && !allowed.has(ch)).sort((x, y) => rankOf(y) - rankOf(x));
  const len = countHan(story.body);
  const lenOk = len >= 550 && len <= 950;
  return { len, extra, ok: lenOk && extra.length <= 3, score: extra.length * 10 + (lenOk ? 0 : Math.abs(len - 700) / 20) };
}

/**
 * What a generated story should teach: due-review characters first, then
 * the next characters in the textbook order this child does not know yet
 * (school's current list preferred).
 */
export async function storyTargets(env) {
  const today = cnDate();
  const known = await knownSet(env);
  const due = (await all(env, "SELECT char FROM chars WHERE status IN ('seen','familiar') AND due_at <= ? ORDER BY due_at LIMIT 3", addDays(today, 1))).map((r) => r.char);
  const met = new Set((await all(env, "SELECT char FROM chars WHERE origin = 'reading'")).map((r) => r.char));
  const upcoming = (await all(env, "SELECT char FROM textbook_chars")).map((r) => r.char).filter((c) => !known.has(c) && !met.has(c));
  const next = [...upcoming, ...LEVEL_ORDER.filter((c) => !known.has(c) && !met.has(c) && rankOf(c) > CORE_RANK)];
  // characters already targeted by stories written but not read yet: let a batch rotate through new ones
  const pending = await all(env, `SELECT a.gen_spec FROM articles a WHERE a.status IN ('queued','processing','ready','flagged') AND a.gen_spec IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.article_id = a.id) LIMIT 200`);
  const taken = new Set(pending.flatMap((r) => { try { return JSON.parse(r.gen_spec).targetsUsed || []; } catch { return []; } }));
  const fresh = [...new Set([...due, ...next])].filter((c) => !taken.has(c));
  return (fresh.length >= 3 ? fresh : [...new Set([...due, ...next])]).slice(0, 5);
}

/** Queue a story to be written by the pipeline. */
export async function enqueueGenerated(env, { hero = false, genre = null, theme = "", focus = null, auto = false, retell = null } = {}) {
  const s = await getSettings(env);
  // follow the class: the current textbook unit supplies theme, genre and skill when not given
  const unit = retell ? null : await currentUnit(env);
  if (unit) {
    const topics = String(unit.topics || "").split(/[、,，\s]+/).filter((t) => t.length >= 2);
    if (!theme && topics.length) theme = topics[Math.floor(Math.random() * topics.length)];
    if (!genre && unit.genre) genre = unit.genre;
    if (!focus && unit.skill) focus = unit.skill;
  }
  const spec = {
    auto,
    retell: retell ? String(retell).slice(0, 20) : null,
    hero: hero ? { name: s.protagonist?.name || s.child_name, traits: s.protagonist?.traits || "", friends: s.protagonist?.friends || "" } : null,
    genre: GENRES.includes(genre) ? genre : "story",
    theme: String(theme || "").slice(0, 40),
    focus: focus || (await weakestAbility(env)),
    targets: await storyTargets(env),
  };
  await run(env, "INSERT OR IGNORE INTO sources (name, kind) VALUES ('AI 定制', 'generated')");
  const src = (await first(env, "SELECT id FROM sources WHERE name = 'AI 定制'")).id;
  const r = await run(env, "INSERT INTO articles (source_id, title, body, genre, status, stage, gen_spec) VALUES (?, ?, '', ?, 'queued', 'generate', ?)",
    src, `（正在写）${spec.retell || spec.theme || (spec.hero ? `${spec.hero.name}的故事` : "新故事")}`, spec.genre, JSON.stringify(spec));
  return { id: r.meta.last_row_id, spec };
}

/** The ability with the lowest first-try rate over 60 days (≥4 answers), for the story's focus. */
async function weakestAbility(env) {
  const rows = await all(env, "SELECT ability, SUM(correct) c, COUNT(*) n FROM answers WHERE created_at >= ? AND attempt = 1 AND ability <> 'predict' GROUP BY ability", addDays(cnDate(), -60));
  const rated = rows.filter((r) => r.n >= 4).sort((x, y) => x.c / x.n - y.c / y.n);
  return rated[0]?.ability || null;
}

/** Characters worth a gloss card: not known, teachable, beyond 一年级 (a struggling reader may still miss those, but they get glossed on demand at pick time). */
export function glossCandidates(uniq, known) {
  return [...(uniq || "")]
    .filter((ch) => !known.has(ch) && rankOf(ch) > VOLUME_END[1] && rankOf(ch) <= MAX_RANK)
    .sort((x, y) => rankOf(x) - rankOf(y))
    .slice(0, GLOSS_CAP);
}

/** Make sure `chars` have gloss rows for article `a` (AI only for the missing ones). */
export async function ensureGlosses(env, a, chars) {
  if (!chars.length) return;
  const have = new Set((await all(env, "SELECT char FROM glosses WHERE article_id = ? AND gloss IS NOT NULL", a.id)).map((r) => r.char));
  const missing = chars.filter((c) => !have.has(c));
  if (!missing.length) return;
  await storeGlosses(env, a, missing, await glossChars(env, { title: a.title, body: a.body, chars: missing }));
}

/** Gloss rows for `chars` (a card without a gloss for any the list misses), pinyin read in context. */
async function storeGlosses(env, a, chars, out) {
  const byChar = new Map(out.map((g) => [g.char, g]));
  const rows = chars.map((ch) => {
    const g = byChar.get(ch) || { char: ch, word: ch, gloss: null, example: null };
    const at = a.body.indexOf(g.word);
    const idx = at >= 0 ? at + [...g.word].indexOf(ch) : a.body.indexOf(ch);
    let py = readingAt(a.body.slice(Math.max(0, idx - 20), idx + 20), Math.min(idx, 20));
    // a neutral-tone reading in context (认识 → shi) is not what a card teaches: use the citation tone
    if (!/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/.test(py)) py = readingOf(ch) || py;
    return stmt(env, "INSERT OR REPLACE INTO glosses (article_id, char, pinyin, word, gloss, example) VALUES (?, ?, ?, ?, ?, ?)",
      a.id, ch, py, g.word, g.gloss, g.example);
  });
  await batch(env, rows);
}

/**
 * Re-apply the parent's pinyin fixes to stored articles containing `word`.
 * Candidates come from the encounters index of the word's rarest character
 * (no full scan of articles); returns the number of articles updated.
 */
export async function reapplyFix(env, word) {
  const chars = [...word];
  const rare = chars.reduce((x, y) => (rankOf(y) > rankOf(x) ? y : x));
  const rows = rankOf(rare) > CORE_RANK
    ? await all(env, "SELECT a.id, a.body, a.pinyin FROM char_encounters e JOIN articles a ON a.id = e.article_id WHERE e.char = ? AND a.pinyin IS NOT NULL", rare)
    : await all(env, "SELECT id, body, pinyin FROM articles WHERE status IN ('ready','flagged') AND instr(body, ?) > 0 LIMIT 500", word);
  const s = await getSettings(env);
  let n = 0;
  for (const r of rows) {
    if (!r.body.includes(word)) continue;
    const paras = paragraphs(r.body);
    const py = JSON.parse(r.pinyin);
    const out = paras.map((p, i) => applyFixes(p, py[i] || "", s.pinyin_fixes));
    await run(env, "UPDATE articles SET pinyin = ? WHERE id = ?", JSON.stringify(out), r.id);
    n++;
  }
  return n;
}

/** Parent actions on an article. */
export async function requeue(env, id, { force = false } = {}) {
  // a generated story whose writing failed starts over from the writing
  await run(env, `UPDATE articles SET status = 'queued', stage = CASE WHEN body = '' AND gen_spec IS NOT NULL THEN 'generate' ELSE 'metrics' END,
    attempts = 0, last_error = NULL, pinyin = NULL, audio = NULL, reject_reason = ? WHERE id = ?`, force ? "家长放行" : null, id);
}
