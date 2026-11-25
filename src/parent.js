// Parent-facing API: report, library review, ingestion, settings,
// textbook lists, monthly passport, reward redemption.
import { all, first, run, stmt, batch, getSettings, setSetting, knownSet, DEFAULT_SETTINGS } from "./db.js";
import { enqueue, step, nextPending, requeue, reapplyFix } from "./pipeline.js";
import { paragraphs, isHan, newCharsFor, newTier } from "./lib/text.js";
import { cnDate, addDays, levelReached } from "./lib/logic.js";
import { ABILITY_NAMES, GENRE_NAMES, GENRES } from "./lib/ai.js";
import { HttpError, safeJSON, snapshot, streakInfo } from "./child.js";

// ---------------------------------------------------------------- report
export async function report(env) {
  const today = cnDate();
  const since = addDays(today, -60);
  const radarRows = await all(env, "SELECT ability, SUM(correct) c, COUNT(*) n FROM answers WHERE created_at >= ? AND attempt = 1 GROUP BY ability", since);
  const radar = Object.keys(ABILITY_NAMES).filter((k) => k !== "locate").map((k) => {
    const r = radarRows.find((x) => x.ability === k);
    return { ability: k, name: ABILITY_NAMES[k], correct: r?.c || 0, total: r?.n || 0, rate: r && r.n ? Math.round((r.c / r.n) * 100) : null };
  });
  const curve = await all(env, "SELECT date, known, mastered FROM snapshots WHERE date >= ? ORDER BY date", addDays(today, -365));
  const monthStart = today.slice(0, 8) + "01";
  const newMastered = await all(env, "SELECT char, pinyin FROM chars WHERE mastered_at >= ? ORDER BY mastered_at", monthStart);
  const history = await all(env, `SELECT s.id, s.date, s.daily, s.level, s.active_ms, s.taps, s.tapped, s.accuracy, s.char_ok, s.char_total, s.bones, s.verdict,
      a.id article_id, a.title, a.char_count, a.genre
    FROM sessions s JOIN articles a ON a.id = s.article_id WHERE s.date >= ? ORDER BY s.date DESC, s.id DESC LIMIT 60`, addDays(today, -45));
  const wrongRows = history.length
    ? await all(env, `SELECT an.session_id, q.prompt, q.options, q.answer, an.choice, an.attempt, q.ability FROM answers an JOIN questions q ON q.id = an.question_id
        WHERE an.session_id IN (${history.map(() => "?").join(",")}) AND an.correct = 0 ORDER BY an.id`, ...history.map((h) => h.id))
    : [];
  const settings = await getSettings(env);
  const st = await streakInfo(env, today, settings);
  const due = await first(env, "SELECT COUNT(*) n FROM chars WHERE status IN ('seen','familiar') AND due_at <= ?", today);
  const assessment = await first(env, "SELECT estimate, at, detail FROM assessments ORDER BY id DESC LIMIT 1");
  const week = history.filter((h) => h.date > addDays(today, -7) && h.daily);
  return {
    today,
    streak: st.streak,
    freezes: st.freezes,
    radar,
    curve,
    newMastered,
    dueReview: due?.n || 0,
    targetNew: settings.target_new,
    assessment: assessment ? { estimate: assessment.estimate, reached: levelReached(assessment.estimate), at: assessment.at, levels: safeJSON(assessment.detail, []) } : null,
    weekDone: week.filter((h) => h.level >= 2).length,
    history: history.map((h) => ({
      id: h.id, date: h.date, daily: !!h.daily, level: h.level, minutes: Math.round(h.active_ms / 6000) / 10,
      taps: h.taps, tapped: h.tapped, accuracy: h.accuracy, charOk: h.char_ok, charTotal: h.char_total, bones: h.bones,
      title: h.title, articleId: h.article_id, chars: h.char_count, genre: GENRE_NAMES[h.genre] || h.genre,
      verdict: safeJSON(h.verdict, null),
      wrong: wrongRows.filter((w) => w.session_id === h.id).map((w) => {
        const opts = safeJSON(w.options, []);
        return { prompt: w.prompt, chose: opts[w.choice], right: opts[w.answer], attempt: w.attempt, ability: ABILITY_NAMES[w.ability] };
      }),
    })),
    suggestion: suggest(radar, settings, due?.n || 0),
  };
}

/** 建议行: next week's tilt, from the data. */
export function suggest(radar, settings, due) {
  const lines = [];
  const rated = radar.filter((r) => r.total >= 4);
  if (rated.length) {
    const weak = [...rated].sort((a, b) => a.rate - b.rate)[0];
    const strong = [...rated].sort((a, b) => b.rate - a.rate)[0];
    if (weak.rate < 70) lines.push(`「${weak.name}」正确率 ${weak.rate}%，下周出题向它倾斜（单篇占比封顶，不会扎堆）。`);
    if (strong.rate >= 85 && strong !== weak) lines.push(`「${strong.name}」已经稳定（${strong.rate}%）。`);
  } else lines.push("答题数据还不够，读满一周后会给出能力倾斜建议。");
  lines.push(`当前每篇目标生字 ${settings.target_new} 个（系统按最近正确率自动升降）。`);
  if (due > 30) lines.push(`待复习生字 ${due} 个，选文会优先挑能让它们复现的文章。`);
  return lines;
}

// ---------------------------------------------------------------- library
export async function listArticles(env, status) {
  const ok = ["queued", "processing", "flagged", "ready", "rejected", "retired"];
  const where = status && ok.includes(status) ? "status = ?" : "status IN ('queued','processing','flagged','ready','rejected')";
  const rows = await all(env, `SELECT id, title, status, stage, genre, char_count, difficulty, coverage, avg_sentence_len, age_fit, ai_note, reject_reason, last_error, created_at
    FROM articles WHERE ${where} ORDER BY id DESC LIMIT 300`, ...(status && ok.includes(status) ? [status] : []));
  const counts = await all(env, "SELECT status, COUNT(*) n FROM articles GROUP BY status");
  return { articles: rows.map((r) => ({ ...r, genreName: GENRE_NAMES[r.genre] || r.genre })), counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) };
}

export async function articleDetail(env, id) {
  const a = await first(env, "SELECT * FROM articles WHERE id = ?", id);
  if (!a) throw new HttpError(404, "not found");
  const qs = await all(env, "SELECT * FROM questions WHERE article_id = ? ORDER BY ord", id);
  const gl = await all(env, "SELECT char, pinyin, word, gloss, example FROM glosses WHERE article_id = ?", id);
  const known = await knownSet(env);
  const { teachable, all: allNew } = newCharsFor(a.uniq || "", known);
  const reads = await all(env, "SELECT id, date, level, accuracy, active_ms FROM sessions WHERE article_id = ? ORDER BY id DESC", id);
  return {
    ...a, uniq: undefined, pinyin: undefined,
    paragraphs: paragraphs(a.body),
    genreName: GENRE_NAMES[a.genre] || a.genre,
    tags: safeJSON(a.tags, []),
    purpose: safeJSON(a.purpose, null),
    questions: qs.map((q) => ({ ...q, options: safeJSON(q.options, []), abilityName: ABILITY_NAMES[q.ability] })),
    glosses: gl,
    newForChild: teachable,
    tierForChild: newTier(teachable.length),
    pinyinParas: safeJSON(a.pinyin, []),
    rareForChild: allNew.filter((c) => !teachable.includes(c)),
    reads,
  };
}

export async function addArticle(env, body) {
  const genre = GENRES.includes(body.genre) ? body.genre : null;
  return enqueue(env, { title: body.title, body: body.body, genre, source: body.source || "家长录入", kind: body.kind || "family_book" });
}

/**
 * Bulk import from one text file: articles separated by lines that start
 * with "=== " followed by the title (e.g. a txt export of a family book).
 */
export function splitBulk(text) {
  const out = [];
  let cur = null;
  for (const line of String(text).replace(/\r\n?/g, "\n").split("\n")) {
    const m = line.match(/^={3,}\s*(.+?)\s*=*\s*$/);
    if (m) {
      if (cur) out.push(cur);
      cur = { title: m[1], lines: [] };
    } else if (cur) cur.lines.push(line);
  }
  if (cur) out.push(cur);
  return out.map((c) => ({ title: c.title, body: c.lines.join("\n").trim() })).filter((c) => c.body);
}

export async function bulkAdd(env, { text, source, genre }) {
  const items = splitBulk(text).slice(0, 200);
  if (!items.length) throw new HttpError(400, "没有找到文章：每篇以一行“=== 标题”开头");
  const results = [];
  for (const it of items) {
    try {
      results.push({ title: it.title, ...(await enqueue(env, { ...it, genre: GENRES.includes(genre) ? genre : null, source: source || "批量导入" })) });
    } catch (e) {
      results.push({ title: it.title, error: e.message });
    }
  }
  return { results };
}

/** Public-domain import from zh.wikisource (one page; simplified variant). */
export async function importWikisource(env, { title, genre }) {
  title = String(title || "").trim();
  if (!title) throw new HttpError(400, "请输入维基文库页面标题");
  const url = `https://zh.wikisource.org/w/api.php?action=parse&format=json&formatversion=2&prop=text&disablelimitreport=1&variant=zh-cn&redirects=1&page=${encodeURIComponent(title)}`;
  const res = await fetch(url, { headers: { "user-agent": "ReadHound/0.1 (family reading app; low-frequency)" } });
  if (!res.ok) throw new HttpError(502, `维基文库返回 ${res.status}`);
  const data = await res.json();
  if (data.error) throw new HttpError(404, `找不到页面：${data.error.info || title}`);
  const text = wikiHtmlToText(data.parse.text);
  if (!text) throw new HttpError(422, "页面里没有可用的正文");
  return enqueue(env, { title: data.parse.title || title, body: text, genre: GENRES.includes(genre) ? genre : null, source: "维基文库", kind: "public_domain" });
}

export function wikiHtmlToText(html) {
  let s = String(html)
    .replace(/<(style|script|table|sup|noscript)[\s\S]*?<\/\1>/gi, "")
    .replace(/<div[^>]*class="[^"]*(?:noprint|header|navbox|licenseContainer|ws-noexport)[^"]*"[\s\S]*?<\/div>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h\d|li|dd|dt)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, "&");
  const paras = s.split("\n").map((p) => p.trim()).filter((p) => p && [...p].some(isHan));
  return paras.join("\n");
}

export async function articleAction(env, id, action) {
  const a = await first(env, "SELECT id, status FROM articles WHERE id = ?", id);
  if (!a) throw new HttpError(404, "not found");
  switch (action) {
    case "approve": // flagged → ready (parent reviewed the content)
      await run(env, "UPDATE articles SET status = 'ready', age_fit = 'ok', reject_reason = NULL WHERE id = ? AND status = 'flagged'", id);
      break;
    case "retire":
      await run(env, "UPDATE articles SET status = 'retired' WHERE id = ?", id);
      break;
    case "requeue":
      await requeue(env, id);
      break;
    case "force": // ignore hard-metric rejection (parent knows the child wants this one)
      await requeue(env, id, { force: true });
      break;
    case "pick": { // read this one today
      const today = cnDate();
      if (a.status !== "ready") throw new HttpError(400, "只有已就绪的文章能设为今日一篇");
      const started = await first(env, "SELECT 1 FROM sessions WHERE date = ? AND daily = 1 LIMIT 1", today);
      if (started) throw new HttpError(409, "今天已经开始读了，明天再换");
      await run(env, "INSERT INTO daily_pick (date, article_id, reason) VALUES (?, ?, '家长指定') ON CONFLICT(date) DO UPDATE SET article_id = excluded.article_id, reason = excluded.reason", today, id);
      break;
    }
    case "delete":
      if (await first(env, "SELECT 1 FROM sessions WHERE article_id = ? LIMIT 1", id)) throw new HttpError(409, "孩子读过这篇，只能下架，不能删除");
      await batch(env, [
        stmt(env, "DELETE FROM questions WHERE article_id = ?", id),
        stmt(env, "DELETE FROM glosses WHERE article_id = ?", id),
        stmt(env, "DELETE FROM char_encounters WHERE article_id = ?", id),
        stmt(env, "DELETE FROM daily_pick WHERE article_id = ?", id),
        stmt(env, "DELETE FROM articles WHERE id = ?", id),
      ]);
      if (env.AUDIO) {
        const list = await env.AUDIO.list({ prefix: `audio/${id}/` });
        for (const o of list.objects) await env.AUDIO.delete(o.key);
      }
      break;
    default:
      throw new HttpError(400, "unknown action");
  }
  return { ok: true };
}

export async function pipelineStep(env) {
  const line = await step(env);
  const pending = await first(env, "SELECT COUNT(*) n FROM articles WHERE status IN ('queued','processing')");
  return { log: line, pending: pending.n };
}

// ---------------------------------------------------------------- pinyin fixes
const SYLLABLE = /^[a-zāáǎàēéěèīíǐìōóǒòūúǔùüǖǘǚǜ]{1,7}$/;

export async function addPinyinFix(env, { word, pinyin }) {
  word = String(word || "").trim();
  const py = String(pinyin || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (![...word].length || ![...word].every(isHan)) throw new HttpError(400, "词语只能是汉字");
  if (py.length !== [...word].length) throw new HttpError(400, `拼音要和字一一对应：${[...word].length} 个字，${py.length} 个拼音`);
  if (!py.every((x) => SYLLABLE.test(x))) throw new HttpError(400, "拼音格式不对，请用带声调的拼音，如 zhǎng zhe");
  const s = await getSettings(env);
  const fixes = (s.pinyin_fixes || []).filter((f) => f.word !== word);
  fixes.push({ word, pinyin: py.join(" ") });
  await setSetting(env, "pinyin_fixes", fixes);
  return { ok: true, updated: await reapplyFix(env, word), fixes };
}

export async function removePinyinFix(env, { word }) {
  const s = await getSettings(env);
  await setSetting(env, "pinyin_fixes", (s.pinyin_fixes || []).filter((f) => f.word !== word));
  return { ok: true, note: "已删除；已改过的文章在“重新处理”后恢复自动拼音" };
}

// ---------------------------------------------------------------- settings
const EDITABLE = ["pinyin", "font_size", "session_min", "rest_min", "daily_limit_min", "bedtime", "wake_time", "interests", "rewards", "audio", "skill_days", "child_name", "target_new", "params"];

export async function getParentSettings(env) {
  const s = await getSettings(env);
  return { ...Object.fromEntries(EDITABLE.map((k) => [k, s[k]])), pinyin_fixes: s.pinyin_fixes || [] };
}

export async function putSettings(env, body) {
  for (const k of EDITABLE) {
    if (!(k in body)) continue;
    const v = body[k];
    const bad = () => { throw new HttpError(400, `invalid ${k}`); };
    switch (k) {
      case "pinyin": if (!["all", "new", "off"].includes(v)) bad(); break;
      case "font_size": if (!(v >= 16 && v <= 40)) bad(); break;
      case "session_min": if (!(v >= 5 && v <= 40)) bad(); break;
      case "rest_min": if (!(v >= 0 && v <= 10)) bad(); break;
      case "daily_limit_min": if (!(v >= 0 && v <= 180)) bad(); break;
      case "bedtime": case "wake_time": if (!/^\d{1,2}:\d{2}$/.test(v)) bad(); break;
      case "interests": if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) bad(); break;
      case "rewards": if (!Array.isArray(v) || v.some((x) => !(x.bones > 0) || typeof x.item !== "string")) bad(); break;
      case "audio": if (typeof v !== "boolean") bad(); break;
      case "skill_days": if (!(v >= 1 && v <= 30)) bad(); break;
      case "child_name": if (typeof v !== "string" || !v.trim() || v.length > 12) bad(); break;
      case "target_new": if (!(v >= 2 && v <= 10)) bad(); break;
      case "params": if (typeof v !== "object") bad(); break;
    }
    await setSetting(env, k, k === "params" ? { ...DEFAULT_SETTINGS.params, ...v } : v);
  }
  return getParentSettings(env);
}

// ---------------------------------------------------------------- characters
/** 课本生字表: 'upcoming' = school is teaching these (選文傾斜); 'known' = already learned. */
export async function textbook(env, { text, unit, mode }) {
  const chars = [...new Set([...String(text || "")].filter(isHan))];
  if (!chars.length) throw new HttpError(400, "没有识别到汉字");
  if (mode === "known") {
    await batch(env, chars.map((ch) => stmt(env,
      "INSERT INTO chars (char, status, origin) VALUES (?, 'familiar', 'textbook') ON CONFLICT(char) DO UPDATE SET status = CASE WHEN chars.status = 'seen' THEN 'familiar' ELSE chars.status END, updated_at = datetime('now')", ch)));
    await snapshot(env, cnDate());
  } else {
    await batch(env, chars.map((ch) => stmt(env, "INSERT OR REPLACE INTO textbook_chars (char, unit) VALUES (?, ?)", ch, unit || null)));
  }
  return { ok: true, count: chars.length };
}

export async function textbookList(env) {
  const rows = await all(env, "SELECT char, unit FROM textbook_chars ORDER BY added_at DESC LIMIT 1000");
  return { chars: rows };
}

export async function clearTextbook(env) {
  await run(env, "DELETE FROM textbook_chars");
  return { ok: true };
}

export async function charsOverview(env, status) {
  const st = ["seen", "familiar", "mastered"].includes(status) ? status : "seen";
  const rows = await all(env, "SELECT char, status, origin, pinyin, gloss, first_seen_at, due_at, lapses, correct_articles, mastered_at FROM chars WHERE status = ? ORDER BY due_at LIMIT 3000", st);
  const counts = await all(env, "SELECT status, origin, COUNT(*) n FROM chars GROUP BY status, origin");
  return { chars: rows.map((r) => ({ ...r, correctArticles: safeJSON(r.correct_articles, []).length, correct_articles: undefined })), counts };
}

export async function markChars(env, { chars, status }) {
  const list = [...new Set([...String(chars || "")].filter(isHan))];
  if (!["familiar", "mastered", "unknown"].includes(status)) throw new HttpError(400, "bad status");
  if (status === "unknown") {
    await batch(env, list.map((ch) => stmt(env, "DELETE FROM chars WHERE char = ? AND origin IN ('assessment','inferred','textbook','parent')", ch)));
  } else {
    await batch(env, list.map((ch) => stmt(env,
      "INSERT INTO chars (char, status, origin, mastered_at) VALUES (?, ?, 'parent', ?) ON CONFLICT(char) DO UPDATE SET status = excluded.status, mastered_at = excluded.mastered_at, updated_at = datetime('now')",
      ch, status, status === "mastered" ? cnDate() : null)));
  }
  await snapshot(env, cnDate());
  return { ok: true, count: list.length };
}

export async function requestAssessment(env) {
  await setSetting(env, "assessment_requested", true);
  return { ok: true };
}

// ---------------------------------------------------------------- rewards & passport
export async function ledger(env) {
  const rows = await all(env, "SELECT id, at, amount, reason FROM ledger ORDER BY id DESC LIMIT 100");
  const bal = await first(env, "SELECT COALESCE(SUM(amount), 0) n FROM ledger");
  const s = await getSettings(env);
  return { balance: bal.n, entries: rows, rewards: s.rewards };
}

export async function redeem(env, { index }) {
  const s = await getSettings(env);
  const r = s.rewards[Number(index)];
  if (!r) throw new HttpError(400, "no such reward");
  const bal = (await first(env, "SELECT COALESCE(SUM(amount), 0) n FROM ledger")).n;
  if (bal < r.bones) throw new HttpError(409, `骨头不够（还差 ${r.bones - bal}）`);
  await run(env, "INSERT INTO ledger (amount, reason, ref) VALUES (?, ?, 'redeem')", -r.bones, `兑换：${r.item}`);
  return ledger(env);
}

/** 阅读护照: one printable page per month. */
export async function passport(env, month) {
  if (!/^\d{4}-\d{2}$/.test(month || "")) month = cnDate().slice(0, 7);
  const from = `${month}-01`, to = `${month}-31`;
  const sessions = await all(env, "SELECT s.date, a.title, a.char_count, s.accuracy FROM sessions s JOIN articles a ON a.id = s.article_id WHERE s.date BETWEEN ? AND ? AND s.level >= 2 ORDER BY s.date", from, to);
  const mastered = await all(env, "SELECT char, pinyin FROM chars WHERE mastered_at BETWEEN ? AND ? ORDER BY mastered_at", from, to);
  const medals = await all(env, "SELECT title, at FROM awards WHERE kind = 'medal' AND at BETWEEN ? AND ? ORDER BY at", from, to + " 23:59:59");
  const s = await getSettings(env);
  return {
    month, childName: s.child_name, sessions, mastered, medals,
    days: [...new Set(sessions.map((x) => x.date))].length,
    chars: sessions.reduce((n, x) => n + x.char_count, 0),
  };
}

export { nextPending };
