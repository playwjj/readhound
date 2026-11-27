// Parent-facing API: report, library review, ingestion, settings,
// textbook lists, monthly passport, reward redemption.
import { all, first, run, stmt, batch, getSettings, setSetting, knownSet, DEFAULT_SETTINGS } from "./db.js";
import { enqueue, step, nextPending, requeue, reapplyFix, enqueueGenerated, aiPausedUntil, PAUSED, INGEST_PURPOSES, ingestCallsToday, checkPrepared } from "./pipeline.js";
import { paragraphs, isHan, newCharsFor, newTier, normalise } from "./lib/text.js";
import { cnDate, addDays, levelReached, weekStart, digestText, webhookPayload } from "./lib/logic.js";
import { ABILITY_NAMES, GENRE_NAMES, GENRES, utcDay } from "./lib/ai.js";
import { CLASSICS } from "./data/classics.js";
import { SHELF } from "./data/shelf.js";
import { splitLong, partLabel } from "./lib/split.js";
import { decode, extract, hanCount } from "./lib/extract.js";
import { HttpError, safeJSON, snapshot, streakInfo } from "./child.js";

// ---------------------------------------------------------------- report
export async function report(env) {
  const today = cnDate();
  const since = addDays(today, -60);
  // first tries, plus 错题回炉 answers: a skill practised again can climb
  const radarRows = await all(env, `SELECT ability, SUM(correct) c, COUNT(*) n FROM (
      SELECT ability, correct FROM answers WHERE created_at >= ? AND attempt = 1
      UNION ALL SELECT ability, correct FROM review_answers WHERE created_at >= ?
    ) GROUP BY ability`, since, since);
  const reviewRows = await all(env, `SELECT r.correct, r.created_at, q.prompt, q.ability, a.title FROM review_answers r
      JOIN questions q ON q.id = r.question_id JOIN articles a ON a.id = q.article_id
    WHERE r.created_at >= ? ORDER BY r.id DESC LIMIT 40`, addDays(today, -30));
  const radar = Object.keys(ABILITY_NAMES).filter((k) => k !== "predict").map((k) => {
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
    ? await all(env, `SELECT an.session_id, q.kind, q.prompt, q.options, q.answer, an.choice, an.attempt, q.ability FROM answers an JOIN questions q ON q.id = an.question_id
        WHERE an.session_id IN (${history.map(() => "?").join(",")}) AND an.correct = 0 AND q.kind <> 'predict' ORDER BY an.id`, ...history.map((h) => h.id))
    : [];
  const retellRows = history.length
    ? await all(env, `SELECT session_id, transcript, covered, total, feedback FROM retells WHERE session_id IN (${history.map(() => "?").join(",")}) ORDER BY id`, ...history.map((h) => h.id))
    : [];
  const fluencyRows = history.length
    ? await all(env, `SELECT session_id, COUNT(*) n, AVG(accuracy) acc, AVG(cpm) cpm FROM fluency_reads WHERE session_id IN (${history.map(() => "?").join(",")}) GROUP BY session_id`, ...history.map((h) => h.id))
    : [];
  const settings = await getSettings(env);
  const st = await streakInfo(env, today, settings);
  const due = await first(env, "SELECT COUNT(*) n FROM chars WHERE status IN ('seen','familiar') AND due_at <= ?", today);
  // the same count the child's home shows (测评 + 阅读 + 课本, familiar or mastered), live rather than the last snapshot
  const knownNow = await first(env, "SELECT COUNT(*) n FROM chars WHERE status IN ('familiar','mastered')");
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
    knownNow: knownNow?.n || 0,
    review: {
      total: reviewRows.length,
      right: reviewRows.filter((r) => r.correct).length,
      items: reviewRows.slice(0, 12).map((r) => ({ date: r.created_at.slice(0, 10), title: r.title, prompt: r.prompt, ability: ABILITY_NAMES[r.ability], correct: !!r.correct })),
    },
    targetNew: settings.target_new,
    assessmentRequested: settings.assessment_requested === true,
    assessment: assessment ? { estimate: assessment.estimate, reached: levelReached(assessment.estimate), at: assessment.at, levels: safeJSON(assessment.detail, []) } : null,
    weekDone: week.filter((h) => h.level >= 2).length,
    history: history.map((h) => ({
      id: h.id, date: h.date, daily: !!h.daily, level: h.level, minutes: Math.round(h.active_ms / 6000) / 10,
      taps: h.taps, tapped: h.tapped, accuracy: h.accuracy, charOk: h.char_ok, charTotal: h.char_total, bones: h.bones,
      title: h.title, articleId: h.article_id, chars: h.char_count, genre: GENRE_NAMES[h.genre] || h.genre,
      verdict: safeJSON(h.verdict, null),
      fluency: (() => {
        const f = fluencyRows.find((x) => x.session_id === h.id);
        return f ? { paras: f.n, accuracy: Math.round(f.acc * 100), cpm: Math.round(f.cpm) } : null;
      })(),
      retell: (() => {
        const r = retellRows.filter((x) => x.session_id === h.id).pop();
        return r ? { transcript: r.transcript, covered: safeJSON(r.covered, []), total: r.total, feedback: r.feedback } : null;
      })(),
      wrong: wrongRows.filter((w) => w.session_id === h.id).map((w) => {
        const opts = safeJSON(w.options, []);
        // 回文定位 answers are sentence keys (paragraph*100 + sentence)
        const pick = (v) => (w.kind === "locate" ? `第 ${Math.floor(v / 100) + 1} 段第 ${(v % 100) + 1} 句` : opts[v]);
        return { prompt: w.prompt, chose: pick(w.choice), right: pick(w.answer), attempt: w.attempt, ability: ABILITY_NAMES[w.ability] };
      }),
    })),
    suggestion: suggest(radar, settings, due?.n || 0),
    digest: await weeklyDigest(env, today),
    monthly: await monthlyTrend(env, today),
  };
}

// ---------------------------------------------------------------- weekly digest & trend
/**
 * 家长周报: last full week (Mon–Sun before this week), in a few numbers and
 * one suggestion. Shown on the report and pushed on Mondays (sendDigest).
 */
export async function weeklyDigest(env, today = cnDate()) {
  const from = addDays(weekStart(today), -7), to = addDays(from, 6);
  const prevFrom = addDays(from, -7);
  const settings = await getSettings(env);
  const [days, done, active, knownNow, before, acc, accPrev, radarRows] = await Promise.all([
    first(env, "SELECT COUNT(*) n FROM days WHERE date BETWEEN ? AND ? AND completed = 1", from, to),
    first(env, "SELECT COUNT(*) n, COALESCE(SUM(a.char_count), 0) chars FROM sessions s JOIN articles a ON a.id = s.article_id WHERE s.date BETWEEN ? AND ? AND s.level >= 2", from, to),
    first(env, "SELECT COALESCE(SUM(active_ms), 0) ms FROM sessions WHERE date BETWEEN ? AND ?", from, to),
    first(env, "SELECT COUNT(*) n FROM chars WHERE status IN ('familiar','mastered')"),
    first(env, "SELECT known FROM snapshots WHERE date < ? ORDER BY date DESC LIMIT 1", from),
    first(env, "SELECT AVG(an.correct) r, COUNT(*) n FROM answers an JOIN sessions s ON s.id = an.session_id WHERE an.attempt = 1 AND an.ability <> 'predict' AND s.date BETWEEN ? AND ?", from, to),
    first(env, "SELECT AVG(an.correct) r, COUNT(*) n FROM answers an JOIN sessions s ON s.id = an.session_id WHERE an.attempt = 1 AND an.ability <> 'predict' AND s.date BETWEEN ? AND ?", prevFrom, addDays(from, -1)),
    all(env, "SELECT ability, SUM(correct) c, COUNT(*) n FROM answers WHERE created_at >= ? AND attempt = 1 AND ability <> 'predict' GROUP BY ability", addDays(today, -30)),
  ]);
  const rated = radarRows.filter((r) => r.n >= 4).map((r) => ({ name: ABILITY_NAMES[r.ability] || r.ability, rate: Math.round((r.c / r.n) * 100) }));
  // a "weakest" skill only when it is actually weak
  const lowest = rated.sort((a, b) => a.rate - b.rate)[0] || null;
  const weak = lowest && lowest.rate < 80 ? lowest : null;
  const daysRead = days?.n || 0;
  const tip = daysRead <= 2
    ? "这周读得少，试试固定一个时间（比如晚饭后），每天一篇就好。"
    : weak && weak.rate < 60
      ? `「${weak.name}」偏弱：读完后问一句“你是从哪句看出来的？”，让孩子指给你看。`
      : "节奏不错！可以问问孩子最喜欢这周哪个故事，让孩子讲给你听。";
  const d = {
    name: settings.child_name, from, to, daysRead,
    articles: done?.n || 0, chars: done?.chars || 0, minutes: Math.round((active?.ms || 0) / 60000),
    knownNow: knownNow?.n ?? null, knownDelta: before ? Math.max(0, (knownNow?.n || 0) - before.known) : null,
    firstTry: acc?.n ? acc.r : null, firstTryPrev: accPrev?.n ? accPrev.r : null, weak, tip,
  };
  return { ...d, text: digestText(d), webhook: !!settings.weekly_webhook, sentWeek: settings.weekly_sent || null };
}

/** 月度趋势: what decides whether the app is worth keeping, month by month. */
export async function monthlyTrend(env, today = cnDate(), months = 6) {
  const start = addDays(today, -31 * (months - 1)).slice(0, 8) + "01";
  const [reads, acc, snaps] = await Promise.all([
    all(env, `SELECT substr(s.date, 1, 7) m, COUNT(*) n, COUNT(DISTINCT s.date) days, COALESCE(SUM(a.char_count), 0) chars
      FROM sessions s JOIN articles a ON a.id = s.article_id WHERE s.level >= 2 AND s.date >= ? GROUP BY m`, start),
    all(env, `SELECT substr(s.date, 1, 7) m, AVG(an.correct) r FROM answers an JOIN sessions s ON s.id = an.session_id
      WHERE an.attempt = 1 AND an.ability <> 'predict' AND s.date >= ? GROUP BY m`, start),
    all(env, "SELECT substr(date, 1, 7) m, MAX(date) d, known FROM snapshots WHERE date >= ? GROUP BY m", start),
  ]);
  const ms = [...new Set([...reads, ...acc, ...snaps].map((r) => r.m))].sort();
  return ms.map((m) => {
    const r = reads.find((x) => x.m === m), a = acc.find((x) => x.m === m), k = snaps.find((x) => x.m === m);
    return { month: m, articles: r?.n || 0, days: r?.days || 0, chars: r?.chars || 0, firstTry: a ? Math.round(a.r * 100) : null, known: k?.known ?? null };
  });
}

/** Push the weekly card to the parent's chat-bot webhook. */
export async function sendDigest(env, { force = false } = {}) {
  const s = await getSettings(env);
  if (!s.weekly_webhook) throw new HttpError(400, "还没有设置周报推送地址");
  const today = cnDate();
  const week = weekStart(today);
  if (!force && s.weekly_sent === week) return { sent: false, already: true };
  const d = await weeklyDigest(env, today);
  const res = await fetch(s.weekly_webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(webhookPayload(s.weekly_webhook, d.text)) });
  if (!res.ok) throw new HttpError(502, `推送失败：对方返回 ${res.status}`);
  if (!force) await setSetting(env, "weekly_sent", week);
  return { sent: true, text: d.text };
}

/** Cron: Monday from 08:00 (Asia/Shanghai), once a week. */
export async function maybeSendDigest(env, nowMs = Date.now()) {
  const s = await getSettings(env);
  if (!s.weekly_webhook) return null;
  const today = cnDate(nowMs);
  const hour = new Date(nowMs + 8 * 3600000).getUTCHours();
  if (new Date(today + "T00:00:00Z").getUTCDay() !== 1 || hour < 8 || s.weekly_sent === weekStart(today)) return null;
  return sendDigest(env);
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
  return { articles: rows.map((r) => ({ ...r, genreName: GENRE_NAMES[r.genre] || r.genre })), counts: Object.fromEntries(counts.map((c) => [c.status, c.n])), aiPaused: await aiPausedUntil(env) };
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
    ...a, uniq: undefined, pinyin: undefined, gen_spec: undefined,
    paragraphs: paragraphs(a.body),
    genreName: GENRE_NAMES[a.genre] || a.genre,
    tags: safeJSON(a.tags, []),
    purpose: safeJSON(a.purpose, null),
    genSpec: safeJSON(a.gen_spec, null),
    questions: qs.map((q) => ({ ...q, options: safeJSON(q.options, []), meta: safeJSON(q.meta, null), abilityName: ABILITY_NAMES[q.ability] })),
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

/** One zh.wikisource page as plain text (traditional is converted at enqueue). */
async function wikisourceText(title) {
  const url = `https://zh.wikisource.org/w/api.php?action=parse&format=json&formatversion=2&prop=text&disablelimitreport=1&redirects=1&page=${encodeURIComponent(title)}`;
  const res = await fetch(url, { headers: { "user-agent": "ReadHound/0.1 (family reading app; low-frequency)" } });
  if (!res.ok) throw new HttpError(502, `维基文库返回 ${res.status}，稍后再试`);
  const data = await res.json();
  if (data.error) throw new HttpError(404, `找不到页面：${data.error.info || title}`);
  const text = wikiHtmlToText(data.parse.text);
  if (!text) throw new HttpError(422, "页面里没有可用的正文");
  return { title: data.parse.title || title, text };
}

/**
 * Queue a text: whole when it fits one sitting, else as parts read in order
 * (part = base + 1, 2, 3 …; a later part is offered after the earlier ones are read).
 */
async function enqueueParts(env, { title, text, genre, source, kind, series = null, base = 0 }) {
  const parts = splitLong(text);
  if (parts.length === 1 && !series) return [{ title, ...(await enqueue(env, { title, body: text, genre, source, kind })) }];
  const out = [];
  for (const [i, body] of parts.entries()) {
    const t = parts.length > 1 ? `${title}（${partLabel(i)}）` : title;
    out.push({ title: t, ...(await enqueue(env, { title: t, body, genre, source, kind, series: series || `text:${title}`, part: base + i + 1 })) });
  }
  return out;
}

/** Public-domain import from zh.wikisource (one page; long pages become parts). */
export async function importWikisource(env, { title, genre }) {
  title = String(title || "").trim();
  if (!title) throw new HttpError(400, "请输入维基文库页面标题");
  const page = await wikisourceText(title);
  const results = await enqueueParts(env, { title: page.title.replace(/\s*\(.*\)$/, ""), text: page.text, genre: GENRES.includes(genre) ? genre : null, source: "维基文库", kind: "public_domain" });
  return { ...results[0], parts: results };
}

/**
 * An article prepared by hand (scripts/prepare.mjs): questions, glosses and
 * the rest come with it, so the pipeline runs without any AI call.
 */
export async function addPrepared(env, b) {
  const body = normalise(String(b.body || ""));
  const genre = GENRES.includes(b.genre) ? b.genre : null;
  try {
    checkPrepared(body, genre, b.prepared);
  } catch (e) {
    throw new HttpError(422, e.message);
  }
  const series = b.series ? String(b.series).slice(0, 80) : null;
  const part = Number.isInteger(b.part) ? b.part : null;
  return enqueue(env, { title: b.title, body, genre, source: b.source || "家长准备", kind: "public_domain", series, part, prepared: b.prepared });
}

// ---------------------------------------------------------------- 公版名篇书架
/** The shelf, with how much of each text is already in the library. */
export async function shelfList(env) {
  const rows = await all(env, `SELECT series, COUNT(*) n, SUM(status = 'ready') ready, MAX(part) maxPart
    FROM articles WHERE series LIKE 'shelf:%' GROUP BY series`);
  const by = new Map(rows.map((r) => [r.series, r]));
  return {
    items: SHELF.map((it) => {
      const r = by.get(`shelf:${it.key}`);
      return {
        key: it.key, title: it.title, author: it.author, genre: it.genre, fit: it.fit, note: it.note,
        pages: it.pages.length, articles: r?.n || 0, ready: r?.ready || 0,
        // pages already fetched (part = page index × 100 + n)
        pagesDone: r ? Math.floor(r.maxPart / 100) + 1 : 0,
      };
    }),
  };
}

/** Import one page of a shelf item (the parent console steps through the pages). */
export async function shelfImport(env, { key, page = 0 }) {
  const it = SHELF.find((x) => x.key === key);
  if (!it) throw new HttpError(404, "书架上没有这一项");
  page = Math.max(0, Math.min(Number(page) || 0, it.pages.length - 1));
  const p = await wikisourceText(it.pages[page]);
  const chapter = it.pages.length > 1 ? `${it.title.replace(/（.*）$/, "")}·${p.title.split("/").pop()}` : it.title;
  const results = await enqueueParts(env, {
    title: chapter, text: p.text, genre: it.genre, source: `维基文库 · ${it.author}`, kind: "public_domain",
    series: `shelf:${it.key}`, base: page * 100,
  });
  return { page, pages: it.pages.length, next: page + 1 < it.pages.length ? page + 1 : null, added: results.filter((r) => r.id).length, results };
}

// ---------------------------------------------------------------- 网页导入
/** A story page the parent found (private family reading); long ones become parts. */
export async function importUrl(env, { url, genre }) {
  let u;
  try {
    u = new URL(String(url || "").trim());
  } catch {
    throw new HttpError(400, "这不是一个网址");
  }
  if (!/^https?:$/.test(u.protocol)) throw new HttpError(400, "只支持 http / https 网址");
  // a wikisource page: its own clean import
  const ws = /(^|\.)wikisource\.org$/.test(u.hostname) && u.pathname.match(/^\/(?:wiki|zh-[a-z]+)\/(.+)$/);
  if (ws) {
    const page = await wikisourceText(decodeURIComponent(ws[1]).replace(/_/g, " "));
    const parts = await enqueueParts(env, { title: page.title.replace(/\s*\(.*\)$/, ""), text: page.text, genre: GENRES.includes(genre) ? genre : null, source: "维基文库", kind: "public_domain" });
    return { title: page.title, chars: hanCount(page.text), parts };
  }
  let res;
  try {
    res = await fetch(u, { headers: { "user-agent": "Mozilla/5.0 (family reading app; low-frequency)", accept: "text/html,*/*" }, redirect: "follow", signal: AbortSignal.timeout(15000) });
  } catch {
    throw new HttpError(502, "打不开这个网址（网站没有响应）");
  }
  if (!res.ok) throw new HttpError(502, `网站返回 ${res.status}：可能不让程序访问。可以把正文复制到“录入一篇”`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length > 3_000_000) throw new HttpError(413, "网页太大了");
  const { title, body } = extract(decode(buf, res.headers.get("content-type") || ""));
  const n = hanCount(body);
  if (n < 200) throw new HttpError(422, `只找到 ${n} 个汉字，不像一篇文章。可以把正文复制到“录入一篇”`);
  if (n > 20000) throw new HttpError(422, `正文有 ${n} 字，太长了：请挑其中一章的网址`);
  const results = await enqueueParts(env, { title: title || u.hostname, text: body, genre: GENRES.includes(genre) ? genre : null, source: u.hostname, kind: "web" });
  return { title: title || u.hostname, chars: n, parts: results };
}

/**
 * Remove whole <div> blocks (nested divs included) whose opening tag matches
 * `test`: wikisource's header box, notes, licence and navigation.
 */
function dropDivs(html, test) {
  let out = "", i = 0;
  const open = /<div\b[^>]*>/gi;
  for (let m; (m = open.exec(html)); ) {
    if (!test(m[0])) continue;
    // find the matching </div>
    const tag = /<(\/?)div\b[^>]*>/gi;
    tag.lastIndex = m.index + m[0].length;
    let depth = 1, t;
    while (depth && (t = tag.exec(html))) depth += t[1] ? -1 : 1;
    const end = t ? t.index + t[0].length : html.length;
    out += html.slice(i, m.index);
    i = end;
    open.lastIndex = end;
  }
  return out + html.slice(i);
}

export function wikiHtmlToText(html) {
  const boiler = /id="(?:headerContainer|plainSister)"|class="[^"]*\b(?:noprint|ws-noexport|licenseContainer|licenseBanner|navbox|wst-|ws-header|mw-references|reflist)|align="left"/i;
  let s = dropDivs(String(html), (tag) => boiler.test(tag))
    .replace(/<(style|script|table|sup|noscript|ul)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h\d|li|dd|dt)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/\[编辑\]|\[編輯\]/g, "");
  const paras = s.split("\n").map((p) => p.replace(/^[\s\u00a0\u3000]+|[\s\u00a0\u3000]+$/g, ""))
    // section numbers and the table-of-contents heading are not text
    .filter((p) => p && [...p].some(isHan) && !/^(目[录錄]|[一二三四五六七八九十]+)$/.test(p));
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
      await run(env, "INSERT INTO daily_pick (date, article_id, reason, alts) VALUES (?, ?, '家长指定', NULL) ON CONFLICT(date) DO UPDATE SET article_id = excluded.article_id, reason = excluded.reason, alts = NULL", today, id);
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

/** §11: a story written for this child (optionally starring them). */
export async function generate(env, { hero, genre, theme, focus }) {
  const okFocus = ["extract", "infer", "summarise", "theme", "word", "locate"];
  return enqueueGenerated(env, { hero: !!hero, genre, theme: String(theme || "").trim(), focus: okFocus.includes(focus) ? focus : null });
}

/** AI usage per UTC day and purpose (last 7 days), for the parent console. */
export async function aiUsage(env) {
  const since = utcDay(Date.now() - 6 * 86400000);
  const rows = await all(env, "SELECT day, purpose, calls, in_chars, out_chars, failures FROM ai_usage WHERE day >= ? ORDER BY day DESC", since);
  const s = await getSettings(env);
  const today = utcDay();
  const ingestToday = rows.filter((r) => r.day === today && INGEST_PURPOSES.includes(r.purpose)).reduce((n, r) => n + r.calls, 0);
  return { rows, today, ingestToday, limit: s.ai_daily_calls, paused: await aiPausedUntil(env) };
}

// ---------------------------------------------------------------- classics (retold)
/** Which classics are still unused (title not in the library, queued or written). */
async function unusedClassics(env, category) {
  const titles = CLASSICS[category]?.titles || [];
  if (!titles.length) return [];
  const used = new Set((await all(env, `SELECT title FROM articles WHERE title IN (${titles.map(() => "?").join(",")}) OR title IN (${titles.map(() => "?").join(",")})`,
    ...titles, ...titles.map((t) => `（正在写）${t}`))).map((r) => r.title.replace(/^（正在写）/, "")));
  return titles.filter((t) => !used.has(t));
}

export async function classics(env) {
  const out = [];
  for (const [key, c] of Object.entries(CLASSICS)) out.push({ key, name: c.name, total: c.titles.length, left: (await unusedClassics(env, key)).length });
  return { categories: out };
}

/** Queue `count` retellings from a category (in list order, skipping ones already in the library). */
export async function queueClassics(env, { category, count }) {
  const n = Math.max(1, Math.min(Number(count) || 5, 30));
  const genre = category === "idiom" ? "idiom" : category;
  const picks = (await unusedClassics(env, category)).slice(0, n);
  if (!picks.length) throw new HttpError(409, "这一类的经典故事都已经在书库里了");
  const queued = [];
  for (const title of picks) queued.push((await enqueueGenerated(env, { retell: title, genre })).id);
  return { queued: picks, ids: queued };
}

/** One pipeline step; {id}: a step of that article only (nothing if it is not pending). */
export async function pipelineStep(env, { id } = {}) {
  const only = id ? await first(env, "SELECT * FROM articles WHERE id = ? AND status IN ('queued','processing')", Number(id)) : null;
  const line = id ? (only ? await step(env, only) : null) : await step(env);
  const pending = await first(env, "SELECT COUNT(*) n FROM articles WHERE status IN ('queued','processing')");
  return { log: line, pending: pending.n, paused: !!line && line.startsWith(PAUSED) };
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
const EDITABLE = ["weekly_webhook", "ai_daily_calls", "protagonist", "auto_generate", "pinyin", "font_size", "session_min", "rest_min", "daily_limit_min", "bedtime", "wake_time", "interests", "rewards", "audio", "skill_days", "child_name", "target_new", "params"];

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
      case "skill_days": if (!(v >= 0 && v <= 30)) bad(); break; // 0 = every skill unlocked now
      case "child_name": if (typeof v !== "string" || !v.trim() || v.length > 12) bad(); break;
      case "target_new": if (!(v >= 2 && v <= 10)) bad(); break;
      case "params": if (typeof v !== "object") bad(); break;
      case "protagonist": if (!v || typeof v !== "object" || ["name", "traits", "friends"].some((k) => typeof (v[k] ?? "") !== "string" || (v[k] || "").length > 60)) bad(); break;
      case "auto_generate": if (typeof v !== "boolean") bad(); break;
      case "ai_daily_calls": if (!(Number.isInteger(v) && v >= 0 && v <= 1000)) bad(); break;
      case "weekly_webhook": if (typeof v !== "string" || v.length > 500 || (v && !/^https:\/\/[^\s]+$/.test(v))) bad(); break;
    }
    await setSetting(env, k, k === "params" ? { ...DEFAULT_SETTINGS.params, ...v } : v);
  }
  // raising (or removing) the daily limit lifts a pause it caused; a quota pause stays
  if ("ai_daily_calls" in body) {
    const cur = await getSettings(env);
    if (cur.ai_paused_reason === "budget" && (body.ai_daily_calls === 0 || body.ai_daily_calls > (await ingestCallsToday(env)))) await setSetting(env, "ai_paused_until", null);
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
