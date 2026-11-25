import { test } from "node:test";
import assert from "node:assert/strict";
import { articleMetrics, hardScreen, sentences, newCharsFor, rankOf, gradeOf, paragraphs, normalise, newTier, VOLUME_END, textbookInfo } from "../src/lib/text.js";
import { annotate, toneVariants, pinyinChoices, polyphonesIn, applyFixes } from "../src/lib/pinyin.js";
import {
  verdict, srsUpdate, rankCandidates, adaptTarget, scoreAssessment, sampleLevel, streakFrom, addDays,
  eyeCare, skillsFor, medalsFor, puppyStage, cnDate, levelChars, levelSize, levelReached, ASSESS_LEVELS,
} from "../src/lib/logic.js";
import { extractJSON, validateQuestions, validateGlosses, validateScreen, validatePolyphones } from "../src/lib/ai.js";
import { splitBulk, wikiHtmlToText, suggest } from "../src/parent.js";
import { readFileSync } from "node:fs";

const sample = readFileSync(new URL("../samples/xiaolieqi-zhaozi.txt", import.meta.url), "utf8").split("\n").slice(1).join("\n");

test("level order follows the textbooks, frequency breaks ties", () => {
  assert.equal(gradeOf("的"), 1);
  assert.ok(rankOf("的") <= 3);
  assert.equal(rankOf("😀"), 9999);
  // adult-corpus frequency puts these past 1600; children meet them in grade 1-2
  assert.equal(gradeOf("猫"), 1);
  assert.equal(gradeOf("熊"), 1);
  assert.equal(gradeOf("鼠"), 2);
  assert.ok(rankOf("猫") <= VOLUME_END[0]);
  assert.equal(VOLUME_END[7], 2597); // 四下: cumulative recognition ≈ 课标 2500
  assert.deepEqual(textbookInfo("猫"), textbookInfo("猫"));
  assert.equal(textbookInfo("勿").recognise, "五年级下册");
  assert.equal(gradeOf("乞"), gradeOf("乞")); // any char resolves
});

test("sentences split on terminal punctuation incl. closing quotes", () => {
  const s = sentences("他说：“你好！”我点点头。真的吗？");
  assert.deepEqual(s, ["他说：“你好！”", "我点点头。", "真的吗？"]);
});

test("metrics on the sample article are within grade-4 parameters", () => {
  const m = articleMetrics(sample);
  assert.ok(m.charCount >= 600 && m.charCount <= 1000, `chars ${m.charCount}`);
  assert.ok(m.coverage > 0.9, `coverage ${m.coverage}`);
  assert.deepEqual(hardScreen(m), []);
  assert.equal(m.uniq.length, new Set(m.uniq).size);
});

test("normalise converts traditional to simplified before analysis", () => {
  assert.equal(normalise("從前，有一隻烏龜。\r\n\r\n  兔子譏笑牠。"), "从前，有一只乌龟。\n兔子讥笑牠。".replace("牠", normalise("牠")));
  const trad = articleMetrics("龜兔賽跑");
  assert.equal(trad.charCount, 4);
});

test("hardScreen rejects a too-short text", () => {
  const why = hardScreen(articleMetrics("小狗跑了。"));
  assert.ok(why.some((w) => w.includes("太短")));
});

test("pinyin annotation aligns one syllable per Han char", () => {
  const p = "小猎犬，长大了！";
  const py = annotate(p).split(" ");
  assert.equal(py.length, 6);
  assert.equal(py[0], "xiǎo");
  assert.equal(py[3], "zhǎng");
});

test("tone variants and quiz choices", () => {
  assert.deepEqual(toneVariants("mā"), ["má", "mǎ", "mà"]);
  assert.deepEqual(toneVariants("le"), []);
  const c = pinyinChoices("quǎn", ["liè", "zhǎo"], 1);
  assert.equal(c.length, 3);
  assert.ok(c.includes("quǎn"));
  // another valid reading of a polyphone is never a distractor
  const d = pinyinChoices("hǎo", ["shū"], 0, new Set(["hǎo", "hào"]));
  assert.ok(!d.includes("hào"));
});

test("newCharsFor separates teachable from rare", () => {
  const { all, teachable } = newCharsFor("的犬龘", new Set(["的"]));
  assert.deepEqual(all, ["犬", "龘"]);
  assert.deepEqual(teachable, ["犬"]);
});

// ---------------------------------------------------------------- verdict
const paras = [100, 100, 100]; // 300 Han chars
const okDwell = [8000, 8000, 8000];
const qs = (pattern) => pattern.flatMap((p, i) => p.map((c, k) => ({ questionId: i + 1, ability: "extract", correct: c, attempt: k + 1, evidence: i })));

test("verdict: normal reading, 3/4 right first try → completed", () => {
  const v = verdict({ paras, dwell: okDwell, activeMs: 120000, answers: qs([[1], [1], [1], [0, 1]]), charQuiz: [{ correct: 1 }, { correct: 1 }] });
  assert.equal(v.completed, true);
  assert.equal(v.level, 2);
  assert.equal(v.accuracy, 0.75);
});

test("verdict: skimmed in 20s but all right → let through (fast reader)", () => {
  const v = verdict({ paras, dwell: [5000, 5000, 5000], activeMs: 20000, answers: qs([[1], [1], [1], [1]]), charQuiz: [] });
  assert.equal(v.tooFast, true);
  assert.equal(v.completed, true);
});

test("verdict: skimmed and 3/4 → not completed, gentle hint points at paragraph", () => {
  const v = verdict({ paras, dwell: [500, 500, 500], activeMs: 20000, answers: qs([[1], [1], [0, 0], [1]]), charQuiz: [] });
  assert.equal(v.completed, false);
  assert.match(v.hint, /第 3 段/);
  assert.deepEqual(v.retryQuestions, [3]);
});

test("verdict: 50% first try, then found every answer after re-reading → recovered", () => {
  const v = verdict({ paras, dwell: okDwell, activeMs: 180000, answers: qs([[1], [1], [0, 1], [0, 0, 1]]), charQuiz: [{ correct: 1 }] });
  assert.equal(v.completed, true);
  assert.equal(v.recovered, true);
});

test("verdict: guessing (25% first try) cannot get through by retries", () => {
  const v = verdict({ paras, dwell: okDwell, activeMs: 180000, answers: qs([[1], [0, 1], [0, 1], [0, 0, 1]]), charQuiz: [] });
  assert.equal(v.completed, false);
});

test("verdict: char quiz failing blocks completion", () => {
  const v = verdict({ paras, dwell: okDwell, activeMs: 120000, answers: qs([[1], [1], [1], [1]]), charQuiz: [{ correct: 0 }, { correct: 0 }, { correct: 1 }] });
  assert.equal(v.completed, false);
  assert.match(v.hint, /生字/);
});

// ---------------------------------------------------------------- SRS
test("srs: seen → familiar → mastered across 3 distinct articles; no double count in one article", () => {
  let r = { status: "seen", correctArticles: [] };
  r = srsUpdate(r, true, 1, "2026-12-01");
  assert.equal(r.status, "familiar");
  r = srsUpdate(r, true, 1, "2026-12-02");
  assert.equal(r.correctArticles.length, 1);
  r = srsUpdate(r, true, 2, "2026-12-03");
  assert.equal(r.status, "familiar");
  r = srsUpdate(r, true, 3, "2026-12-05");
  assert.equal(r.status, "mastered");
  assert.equal(r.dueAt, null);
  r = srsUpdate(r, false, 4, "2026-12-09");
  assert.equal(r.status, "familiar");
  assert.equal(r.dueAt, "2026-12-10");
});

// ---------------------------------------------------------------- pick
test("rankCandidates prefers ~target new chars, due review and interests", () => {
  const known = new Set([..."的一是了我不人在他有这个上们来到时大地为子中你说生国年着就那和要她出也得里后自以会家可下而过天去能对小多然于心学么之都好看起发当没成只如事把还用第样道想作种开美总从无情己面最女但现前些所同日手又行意动方期它头经长儿回位分爱老因很给名法间斯知世什两次使身者被高已亲其进此话常与活正感见明问力理尔点文几定本公特做外孩相西果走将月十实向声车全信重三机工物气每并别真打太新比才便夫再书部水像眼等体却加电主界门利海受听表德少克代员许稜先口由死安写性马光白或住难望教命花结乐色更拉东神记处让母父应直字场平报友关放至张认接告入笑内英军候民岁往何度山觉路带万男边风解叫任金快原吃妈变通师立象数四失满战远格士音轻目条呢"]);
  const cands = [
    { id: 1, uniq: "的一是犬猎嗅", difficulty: 30, genre: "story", tags: [], charCount: 700 },
    { id: 2, uniq: "的一是犬猎嗅踪迹爪尾巴耳朵骨", difficulty: 30, genre: "story", tags: [], charCount: 700 },
    { id: 3, uniq: "的一是犬猎嗅踪迹", difficulty: 30, genre: "science", tags: ["动物"], charCount: 700 },
  ];
  const ranked = rankCandidates(cands, { known, due: new Set(), upcoming: new Set(), recentGenres: ["story"], interests: ["动物"], targetNew: 5 });
  assert.equal(ranked[0].id, 3);
  assert.equal(ranked[ranked.length - 1].id, 2);
});

test("adaptTarget steps down after two weak sessions, up after three strong", () => {
  assert.equal(adaptTarget(5, [0.5, 0.4, 0.9]), 4);
  assert.equal(adaptTarget(5, [0.9, 1, 0.95]), 6);
  assert.equal(adaptTarget(2, [0.1, 0.1]), 2);
  assert.equal(adaptTarget(5, [0.8]), 5);
});

// ---------------------------------------------------------------- assessment
test("assessment: sampling is deterministic and within level", () => {
  const a = sampleLevel(3, 8, 42), b = sampleLevel(3, 8, 42);
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, 8);
  const lvl = new Set(levelChars(3));
  assert.ok(a.every((c) => lvl.has(c)));
});

test("assessment: passed levels inferred known, partial level only right answers", () => {
  const res = [];
  for (const ch of sampleLevel(0, 8, 1)) res.push({ level: 0, char: ch, correct: true });
  const l1 = sampleLevel(1, 8, 1);
  l1.forEach((ch, i) => res.push({ level: 1, char: ch, correct: i < 4 }));
  const r = scoreAssessment(res);
  assert.equal(levelSize(0), 300); // 一年级上册
  assert.equal(r.known.size, 300 + 4);
  assert.equal(r.estimate, 300 + 200);
  assert.equal(r.levels[0].name, "一年级上册");
  assert.equal(ASSESS_LEVELS, 11);
  assert.equal(levelReached(1600), "二年级下册");
  assert.equal(levelReached(100), "一年级上册之前");
});

// ---------------------------------------------------------------- streak & misc
test("streak counts back from today or yesterday, freezes count", () => {
  const today = "2026-12-10";
  const days = [
    { date: "2026-12-09", completed: 1 }, { date: "2026-12-08", freeze_used: 1 }, { date: "2026-12-07", completed: 1 },
    { date: "2026-12-05", completed: 1 },
  ];
  assert.equal(streakFrom(days, today), 3);
  assert.equal(streakFrom([...days, { date: today, completed: 1 }], today), 4);
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.match(cnDate(Date.UTC(2026, 0, 1, 17)), /^2026-01-02$/);
});

test("eye care: limit and bedtime switch to listen-only", () => {
  const s = { daily_limit_min: 30, bedtime: "21:00", wake_time: "06:00", session_min: 15, rest_min: 2 };
  const noonCN = Date.UTC(2026, 11, 1, 4); // 12:00 Shanghai
  assert.equal(eyeCare(s, 10 * 60000, noonCN).listenOnly, false);
  assert.equal(eyeCare(s, 31 * 60000, noonCN).reason, "limit");
  assert.equal(eyeCare(s, 0, Date.UTC(2026, 11, 1, 14)).reason, "bedtime"); // 22:00
  assert.equal(eyeCare(s, 0, Date.UTC(2026, 11, 1, 21)).reason, "bedtime"); // 05:00
});

test("skills unlock in order; phase-2 skills stay locked", () => {
  const s = skillsFor(5, 5);
  assert.equal(s.find((x) => x.key === "purpose").unlocked, true);
  assert.equal(s.find((x) => x.key === "guess").unlocked, false);
  assert.equal(s.find((x) => x.key === "retell").unlocked, false);
});

test("medals and puppy stages", () => {
  const m = medalsFor({ streak: 8, completed: 10, mastered: 120, charsRead: 12000 }).map((x) => x.code);
  assert.ok(m.includes("medal:streak7") && m.includes("medal:read10") && m.includes("medal:chars100") && m.includes("medal:words10000"));
  assert.ok(!m.includes("medal:chars150"));
  assert.equal(puppyStage(0).key, "pup");
  assert.equal(puppyStage(7).key, "young");
  assert.equal(puppyStage(6).next.need, 1);
});

// ---------------------------------------------------------------- AI validation
test("extractJSON tolerates fences and chatter", () => {
  assert.deepEqual(extractJSON('好的：\n```json\n{"a":[1,"}"]}\n```'), { a: [1, "}"] });
});

test("validateQuestions enforces structure and maps evidence to 0-based", () => {
  const body = "第一段讲小狗。\n第二段讲小猫。\n第三段讲小鸟。";
  const ok = validateQuestions({
    purpose: { task: "留意有几种动物", q: 0 },
    questions: [
      { ability: "extract", prompt: "第一段讲谁？", options: ["小狗", "小猫", "小鸟"], answer: 0, evidence: 1 },
      { ability: "extract", prompt: "第二段讲谁？", options: ["小狗", "小猫", "小鸟"], answer: 1, evidence: 2 },
      { ability: "infer", prompt: "一共几种？", options: ["一", "二", "三"], answer: 2, evidence: 9 },
    ],
    guess: { word: "小鸟", options: ["鸟", "猫", "狗"], answer: 0 },
  }, body);
  assert.equal(ok.questions[0].evidence, 0);
  assert.equal(ok.questions[2].evidence, null);
  assert.equal(ok.guess.evidence, 2);
  assert.throws(() => validateQuestions({ questions: [{ prompt: "x", options: ["a", "a", "b"], answer: 0 }] }, body));
  assert.throws(() => validateQuestions({ questions: [{ prompt: "x", options: ["a", "b", "c"], answer: 5 }] }, body));
});

test("validateGlosses falls back to the char when the word is not in the text", () => {
  const out = validateGlosses([{ char: "犬", word: "猎犬", gloss: "狗" }, { char: "嗅", word: "瞎编", gloss: "闻" }], "小猎犬嗅一嗅。", ["犬", "嗅"]);
  assert.equal(out[0].word, "猎犬");
  assert.equal(out[1].word, "嗅");
  assert.throws(() => validateGlosses([], "x", ["犬", "嗅"]));
});

test("validateScreen normalises genre and rejects bad age_fit", () => {
  assert.equal(validateScreen({ age_fit: "ok", genre: "alien", tags: ["动物"] }).genre, "story");
  assert.throws(() => validateScreen({ age_fit: "maybe" }));
});

// ---------------------------------------------------------------- parent helpers
test("splitBulk splits on === title lines", () => {
  const items = splitBulk("前言忽略\n=== 第一篇\n内容一\n\n=== 第二篇 ===\n内容二\n=== 空的\n");
  assert.deepEqual(items.map((x) => x.title), ["第一篇", "第二篇"]);
  assert.equal(items[0].body, "内容一");
});

test("wikiHtmlToText keeps paragraphs, drops refs and tables", () => {
  const t = wikiHtmlToText('<div class="ws-noexport">导航</div><table><tr><td>表</td></tr></table><p>从前有座山<sup class="reference">[1]</sup>。</p><p>山里有座庙&amp;。</p><p>   </p>');
  assert.deepEqual(paragraphs(t), ["从前有座山。", "山里有座庙&。"]);
});

test("suggest names the weakest ability", () => {
  const lines = suggest([{ name: "推断", rate: 40, total: 10 }, { name: "信息提取", rate: 90, total: 10 }], { target_new: 5 }, 0);
  assert.match(lines[0], /推断/);
});

test("tiers: PASS ≤8, REVIEW ≤15, later beyond; picking never prefers a harder tier", () => {
  assert.deepEqual([0, 8, 9, 15, 16].map(newTier), ["pass", "pass", "review", "review", "later"]);
  const hard = [..."嗅踪迹爪尾巴耳朵骨猎犬茂棵挤汪熊驯鹰哗"].join("");
  const ranked = rankCandidates([
    { id: 1, uniq: hard, difficulty: 10, genre: "story", tags: ["动物"], charCount: 700 },
    { id: 2, uniq: hard.slice(0, 18), difficulty: 10, genre: "story", tags: [], charCount: 700 },
    { id: 3, uniq: hard.slice(0, 10), difficulty: 90, genre: "story", tags: [], charCount: 300 },
  ], { known: new Set(), due: new Set(), upcoming: new Set(), recentGenres: [], interests: ["动物"], targetNew: 5 });
  assert.equal(ranked[0].id, 3); // the only REVIEW-tier one wins despite worse score
  assert.equal(ranked[1].id, 2); // among "later", fewest new characters first
});

test("adult explanatory prose is rejected on sentence length", () => {
  const adult = "这个寓言故事通过对比兔子和乌龟在比赛过程中所表现出来的截然不同的态度和行为方式告诉我们一个非常深刻的道理。".repeat(12);
  assert.ok(hardScreen(articleMetrics(adult)).some((w) => w.includes("句子太长")));
});

test("polyphones: candidates found, particles skipped, model answers constrained", () => {
  const p = "长着一根根又长又硬的胡子，他还了书。";
  const items = polyphonesIn(p);
  assert.deepEqual(items.map((x) => x.char), ["长", "长", "还"]);
  assert.equal(items[0].index, 0);
  assert.ok(items[2].candidates.includes("huán"));
  assert.match(items[1].context, /^长着一根根又【长】又硬/); // the target is marked, not ambiguous
  const ans = validatePolyphones({ 0: "zhǎng", 1: "cháng", 2: "huan" }, items);
  assert.deepEqual(ans, { 0: "zhǎng", 1: "cháng" }); // "huan" (no tone) is not a candidate → keep pinyin-pro
  // neutral tone kept: the model may not "upgrade" 喜欢 huan → huān
  const neutral = [{ char: "欢", reading: "huan", candidates: ["huan", "huān"] }, { char: "兴", reading: "xīng", candidates: ["xīng", "xìng"] }];
  assert.deepEqual(validatePolyphones({ 0: "huān", 1: "xìng" }, neutral), { 1: "xìng" });
});

test("applyFixes rewrites every occurrence of a word, aligned to Han chars", () => {
  const p = "长着胡子，“长着”呢。";
  const syl = annotate(p);
  const out = applyFixes(p, syl, [{ word: "长着", pinyin: "zhǎng zhe" }]).split(" ");
  assert.equal(out[0], "zhǎng");
  assert.equal(out[4], "zhǎng");
  assert.equal(out.length, syl.split(" ").length);
  assert.equal(applyFixes(p, syl, [{ word: "长着", pinyin: "zhǎng" }]), syl); // length mismatch ignored
});
