// End-to-end smoke test against a running Worker (default: local dev).
//   BASE=http://127.0.0.1:8799 PARENT_PIN=8888 CHILD_PIN=1234 node scripts/smoke.mjs
// Uses the public samples in samples/. Run against a fresh local DB with AI_MOCK=1.
import { readFileSync, readdirSync } from "node:fs";

const BASE = process.env.BASE || "http://127.0.0.1:8799";
const jar = { parent: "", child: "" };

async function call(role, method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", cookie: jar[role], ...(role === "parent" ? { "x-rh-area": "parent" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.get("set-cookie");
  if (sc) jar[role] = sc.split(";")[0];
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
  return data;
}
const ok = (cond, msg) => {
  if (!cond) throw new Error("FAILED: " + msg);
  console.log("  ✓", msg);
};

console.log("login");
ok((await call("parent", "POST", "/api/login", { pin: process.env.PARENT_PIN || "8888" })).role === "parent", "parent PIN");
ok((await call("child", "POST", "/api/login", { pin: process.env.CHILD_PIN || "1234" })).role === "child", "child PIN");
let denied = false;
try { await call("child", "GET", "/api/parent/report"); } catch { denied = true; }
ok(denied, "child cannot open parent API");
const leak = await fetch(BASE + "/api/parent/report", { headers: { cookie: jar.parent } });
ok(leak.status === 403, "a parent cookie gives no parent rights to the child app (no area header)");

console.log("ingest samples");
const dir = new URL("../samples/", import.meta.url);
for (const f of readdirSync(dir).filter((x) => x.endsWith(".txt"))) {
  // first line is the title when short; otherwise the file name (e.g. untitled reference samples)
  const lines = readFileSync(new URL(f, dir), "utf8").split("\n");
  const titled = [...lines[0].trim()].length <= 20;
  const title = titled ? lines[0].trim() : f.replace(/\.txt$/, "");
  const rest = titled ? lines.slice(1) : lines;
  const r = await call("parent", "POST", "/api/parent/articles", { title, body: rest.join("\n"), source: "示例（公开）", kind: "sample" });
  console.log("   ", title, r);
}
for (let i = 0; i < 40; i++) {
  const r = await call("parent", "POST", "/api/parent/pipeline/step");
  if (r.log) console.log("   ", r.log);
  if (!r.pending) break;
}
const lib = await call("parent", "GET", "/api/parent/articles?status=ready");
ok(lib.articles.length >= 2, `${lib.articles.length} articles ready`);
const detail = await call("parent", "GET", `/api/parent/articles/${lib.articles[0].id}`);
ok(detail.questions.length >= 4, `article has ${detail.questions.length} questions`);

console.log("assessment");
const home0 = await call("child", "GET", "/api/home");
if (home0.needAssessment) {
  // simulate a child who knows 一上–二上, half of 二下, then stops (二下 < 80%)
  const { pinyin } = await import("pinyin-pro");
  const results = [];
  for (let level = 0; level <= 3; level++) {
    const L = await call("child", "GET", `/api/assessment/level/${level}?seed=7`);
    L.items.forEach((it, i) => results.push({ level, char: it.char, choice: level < 3 || i % 2 === 0 ? pinyin(it.char) : null }));
  }
  const a = await call("child", "POST", "/api/assessment/finish", { results });
  // levels follow the textbook volumes: 一上+一下+二上 (1150) + half of 二下 ≈ 1375
  ok(a.estimate > 1250 && a.estimate < 1500 && a.reached === "二年级上册", `estimate ${a.estimate} (约到${a.reached}), known ${a.known}`);
}

await call("parent", "PUT", "/api/parent/settings", { skill_days: 0 }); // every skill on, so the smoke covers them all

console.log("reading session");
const home = await call("child", "GET", "/api/home");
ok(home.article, `today's pick: ${home.article?.title}`);
const S = await call("child", "POST", "/api/session/start", {});
ok(S.article.paragraphs.length > 3, `${S.article.paragraphs.length} paragraphs, ${S.newChars.length} new chars, ${S.charQuiz.length} quiz chars`);
ok(S.article.paragraphs.every((p) => p.py.split(" ").length === [...p.text].filter((c) => /\p{Script=Han}/u.test(c)).length), "pinyin aligned with every paragraph");
const again = await call("child", "POST", "/api/session/start", {});
ok(again.session.id === S.session.id, "re-opening resumes the same session");

const sid = S.session.id;
const dwell = S.article.paragraphs.map((p) => p.text.length * 120);
await call("child", "POST", `/api/session/${sid}/progress`, { lastParagraph: dwell.length - 1, dwell, activeMs: dwell.reduce((a, b) => a + b, 0), screenMsDelta: 60000, taps: ["森"] });

// answer: first wrong on q0 (look back), then right; others right first time
const det = await call("parent", "GET", `/api/parent/articles/${S.article.id}`);
const answerOf = new Map(det.questions.map((q) => [q.id, q.answer]));
const q0 = S.questions[0];
const wrong = await call("child", "POST", `/api/session/${sid}/answer`, { questionId: q0.id, choice: (answerOf.get(q0.id) + 1) % q0.options.length });
ok(!wrong.correct && wrong.hint && wrong.answer === undefined, "wrong first answer → hint, answer not revealed");
await call("child", "POST", `/api/session/${sid}/answer`, { questionId: q0.id, choice: answerOf.get(q0.id) });
for (const q of S.questions.slice(1)) await call("child", "POST", `/api/session/${sid}/answer`, { questionId: q.id, choice: answerOf.get(q.id) });

// phase-2 skills
ok(S.predict && S.locates.length && S.sections.length >= 3, `skills served: predict after ¶${S.predict?.after + 1}, ${S.locates.length} locate, ${S.sections.length} sections`);
const P = await call("child", "POST", `/api/session/${sid}/answer`, { questionId: S.predict.id, choice: 2 });
ok(P.recorded && S.predict.options[P.answer] === "（模拟）实际走向", "prediction recorded, revealed later");
const L = S.locates[0];
const lq = det.questions.find((q) => q.id === L.id);
const wrongKey = L.paras[0].index * 100 + (L.paras[0].index === lq.meta.para ? (lq.meta.sentence + 1) % L.paras[0].sentences.length : 0);
const lw = await call("child", "POST", `/api/session/${sid}/answer`, { questionId: L.id, choice: wrongKey });
ok(!lw.correct && lw.hint && lw.answer === undefined, "locate: wrong sentence → hint");
ok((await call("child", "POST", `/api/session/${sid}/answer`, { questionId: L.id, choice: lq.answer })).correct, "locate: evidence sentence found");
for (const sec of S.sections) await call("child", "POST", `/api/session/${sid}/answer`, { questionId: sec.id, choice: det.questions.find((q) => q.id === sec.id).answer });
ok(S.sections[0].from === 0 && S.sections[S.sections.length - 1].to === S.article.paragraphs.length - 1, "sections cover the whole article");

for (const [i, c] of S.charQuiz.entries()) {
  const right = S.newChars.concat(S.reviewChars).find((x) => x.char === c.char).pinyin;
  const r = await call("child", "POST", `/api/session/${sid}/charquiz`, { char: c.char, choice: i === 0 ? "zzz" : right });
  ok(r.correct === (i !== 0), `char quiz ${c.char} ${r.correct ? "right" : "wrong"} → ${r.status}`);
}
const F = await call("child", "POST", `/api/session/${sid}/finish`);
ok(F.verdict.completed, `completed: accuracy ${F.verdict.accuracy}, chars ${F.verdict.charOk}/${F.verdict.charTotal}`);
ok(F.rewards && F.rewards.total >= 10, `bones +${F.rewards?.total}, chest: ${F.rewards?.chest?.text}`);
ok(F.rewards.medals.some((m) => m.code === "medal:read1"), "first medal");
const F2 = await call("child", "POST", `/api/session/${sid}/finish`);
ok(F2.rewards === null && F2.alreadyCompleted, "finishing twice does not pay twice");

console.log("voice retelling");
const audio = new Uint8Array(4000).fill(7);
async function retell() {
  const r = await fetch(`${BASE}/api/session/${sid}/retell`, { method: "POST", body: audio, headers: { "content-type": "audio/mp4", cookie: jar.child } });
  return { status: r.status, ...(await r.json()) };
}
const R1 = await retell();
ok(R1.passed && R1.level === 3 && R1.bones === 3 && R1.covered.length === 3, `retell: ${R1.covered.length} points told → 完成复述, +${R1.bones} bones`);
const R2 = await retell();
ok(R2.bones === 0 && R2.triesLeft === 0, "second retell pays nothing more");
ok((await retell()).status === 429, "a third retell is refused (live model calls are capped)");

const h2 = await call("child", "GET", "/api/home");
ok(h2.todayDone && h2.streak === 1 && h2.completed === 1 && h2.bones === 13, `home: streak ${h2.streak}, completed ${h2.completed}, bones ${h2.bones}`);

console.log("archive & report");
const ch = S.newChars[0]?.char;
if (ch) {
  const card = await call("child", "GET", `/api/chars/${encodeURIComponent(ch)}`);
  ok(card.seenIn.length === 1, `「${ch}」 seen in: ${card.seenIn.map((x) => x.title).join(",")} (${card.status})`);
}
const col = await call("child", "GET", "/api/collection");
ok(col.cards.length === S.newChars.length, `collection has ${col.cards.length} cards`);
const rep = await call("parent", "GET", "/api/parent/report");
ok(rep.history.length === 1 && rep.radar.some((r) => r.total > 0), "report has history + radar");
ok(rep.history[0].level === 3 && rep.history[0].retell?.covered.length === 3, "report shows the retelling");
ok(rep.history[0].wrong.length === 2 && !rep.history[0].wrong.some((w) => w.ability === "预测"), "report lists the wrong answers (a different prediction is not one)");
ok(rep.radar.some((r) => r.ability === "locate" && r.total === 1), "回文定位 on the radar");
const pp = await call("parent", "GET", "/api/parent/passport");
ok(pp.sessions.length === 1, "passport lists the reading");

console.log("extra reading");
const E = await call("child", "POST", "/api/session/start", { extra: true });
ok(E.article.id !== S.article.id && !E.session.daily, `extra: ${E.article.title}`);

console.log("generated stories");
await call("parent", "PUT", "/api/parent/settings", { protagonist: { name: "乐乐", traits: "爱踢球", friends: "" } });
const G = await call("parent", "POST", "/api/parent/generate", { hero: true, theme: "帮小狗找家" });
ok(G.spec.hero.name === "乐乐" && G.spec.targets.length > 0, `story queued, targets ${G.spec.targets.join("")}`);
for (let i = 0; i < 60; i++) { const r = await call("parent", "POST", "/api/parent/pipeline/step"); if (!r.pending) break; }
const GA = await call("parent", "GET", `/api/parent/articles/${G.id}`);
ok(GA.status === "ready" && GA.body.includes("乐乐") && GA.genSpec.rounds.length >= 1, `「${GA.title}」 ready, ${GA.char_count} chars, rounds: ${GA.genSpec.rounds.map((r) => r.extra).join("→")} extra chars`);
ok(GA.genSpec.rounds[GA.genSpec.rounds.length - 1].extra <= GA.genSpec.rounds[0].extra, "rewrites never leave more unknown characters");

// cron: fewer than 2 suitable unread articles → one story is written (once a day)
const before = (await call("parent", "GET", "/api/parent/articles")).articles.length;
await fetch(`${BASE}/cdn-cgi/handler/scheduled?cron=*/30+*+*+*+*`);
await fetch(`${BASE}/cdn-cgi/handler/scheduled?cron=*/30+*+*+*+*`);
const after = (await call("parent", "GET", "/api/parent/articles")).articles;
const autos = after.filter((a) => a.id > G.id);
ok(after.length === before + 1 && autos.length === 1, `cron queued exactly one 补位 story (#${autos[0]?.id} ${autos[0]?.status})`);

console.log("\nALL GOOD");
