// Ingest pipeline (§4–§6): one article, one stage per step, so every
// invocation stays small (Worker CPU limits) and failures retry per stage.
//   metrics → screen → pinyin → encounters → glosses → questions → audio → ready
import { all, first, run, stmt, batch, getSettings, knownSet } from "./db.js";
import { normalise, paragraphs, articleMetrics, hardScreen, rankOf, CORE_RANK, MAX_RANK, VOLUME_END, newCharsFor } from "./lib/text.js";
import { annotate, readingAt, readingOf } from "./lib/pinyin.js";
import { screenArticle, glossChars, makeQuestions, tts } from "./lib/ai.js";

export const STAGES = ["metrics", "screen", "pinyin", "encounters", "glosses", "questions", "audio"];
const MAX_ATTEMPTS = 3;
const GLOSS_CAP = 24;

/** Queue a new article. Returns {id} or {duplicate}. */
export async function enqueue(env, { title, body, genre, source, kind = "family_book" }) {
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
  const r = await run(env, "INSERT INTO articles (source_id, title, body, genre, status, stage) VALUES (?, ?, ?, ?, 'queued', 'metrics')", sourceId, title, body, genre || null);
  return { id: r.meta.last_row_id };
}

/** Next article with pending work (index: status). */
export async function nextPending(env) {
  return first(env, "SELECT * FROM articles WHERE status IN ('queued','processing') ORDER BY id LIMIT 1");
}

/** Run one stage of one article. Returns a short log line. */
export async function step(env, article) {
  const a = article || (await nextPending(env));
  if (!a) return null;
  const stage = a.stage;
  try {
    const done = await STAGE_FN[stage](env, a);
    if (done === "stay") return `#${a.id} ${stage} (continuing)`;
    if (done === "stop") return `#${a.id} ${stage} → stopped`;
    const next = STAGES[STAGES.indexOf(stage) + 1];
    if (next) await run(env, "UPDATE articles SET status = 'processing', stage = ?, attempts = 0, last_error = NULL WHERE id = ?", next, a.id);
    else await run(env, "UPDATE articles SET status = CASE WHEN age_fit = 'flagged' THEN 'flagged' ELSE 'ready' END, stage = 'done', ready_at = datetime('now'), attempts = 0, last_error = NULL WHERE id = ?", a.id);
    return `#${a.id} ${stage} ok`;
  } catch (e) {
    const attempts = (a.attempts || 0) + 1;
    const msg = String(e && (e.message || e)).slice(0, 300);
    console.error(`[pipeline] #${a.id} ${stage} failed (${attempts}):`, e && (e.stack || msg));
    if (attempts >= MAX_ATTEMPTS) {
      if (stage === "audio") {
        // audio is optional: the device voice reads instead
        await run(env, "UPDATE articles SET status = CASE WHEN age_fit = 'flagged' THEN 'flagged' ELSE 'ready' END, stage = 'done', ready_at = datetime('now'), last_error = ? WHERE id = ?", `audio skipped: ${msg}`, a.id);
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
  }
  return log;
}

const STAGE_FN = {
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
    const r = await screenArticle(env, { title: a.title, body: a.body, interests: s.interests });
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

  async encounters(env, a) {
    const counts = new Map();
    for (const ch of a.body) if (a.uniq.includes(ch) && rankOf(ch) > CORE_RANK) counts.set(ch, (counts.get(ch) || 0) + 1);
    await run(env, "DELETE FROM char_encounters WHERE article_id = ?", a.id);
    await batch(env, [...counts].map(([ch, n]) => stmt(env, "INSERT INTO char_encounters (char, article_id, occurrences) VALUES (?, ?, ?)", ch, a.id, n)));
  },

  async glosses(env, a) {
    const known = await knownSet(env);
    const chars = glossCandidates(a.uniq, known);
    await ensureGlosses(env, a, chars);
  },

  async questions(env, a) {
    const known = await knownSet(env);
    const { teachable } = newCharsFor(a.uniq, known);
    const guessChars = (teachable.length ? teachable : glossCandidates(a.uniq, known)).slice(0, 8);
    const q = await makeQuestions(env, { title: a.title, body: a.body, guessChars });
    const list = [...q.questions];
    if (q.guess) list.push(q.guess);
    await run(env, "DELETE FROM questions WHERE article_id = ?", a.id);
    await batch(env, list.map((x, i) => stmt(env,
      "INSERT INTO questions (article_id, ord, kind, ability, prompt, options, answer, evidence, word, explain) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      a.id, i, x.kind, x.ability, x.prompt, JSON.stringify(x.options), x.answer, x.evidence, x.word || null, x.explain || null)));
    await run(env, "UPDATE articles SET purpose = ? WHERE id = ?", q.purpose ? JSON.stringify(q.purpose) : null, a.id);
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
  const out = await glossChars(env, { title: a.title, body: a.body, chars: missing });
  const byChar = new Map(out.map((g) => [g.char, g]));
  const rows = missing.map((ch) => {
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

/** Parent actions on an article. */
export async function requeue(env, id, { force = false } = {}) {
  await run(env, "UPDATE articles SET status = 'queued', stage = 'metrics', attempts = 0, last_error = NULL, pinyin = NULL, audio = NULL, reject_reason = ? WHERE id = ?", force ? "家长放行" : null, id);
}
