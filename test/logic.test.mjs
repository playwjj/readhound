import { test } from "node:test";
import assert from "node:assert/strict";
import { articleMetrics, hardScreen, sentences, newCharsFor, rankOf, gradeOf, paragraphs, normalise, newTier, VOLUME_END, textbookInfo, splitSentences, locateSentence } from "../src/lib/text.js";
import { annotate, toneVariants, pinyinChoices, polyphonesIn, applyFixes } from "../src/lib/pinyin.js";
import {
  verdict, srsUpdate, rankCandidates, adaptTarget, scoreAssessment, sampleLevel, streakFrom, addDays,
  eyeCare, skillsFor, medalsFor, puppyStage, cnDate, levelChars, levelSize, levelReached, ASSESS_LEVELS,
} from "../src/lib/logic.js";
import { extractJSON, validateQuestions, validateGlosses, validateScreen, validatePolyphones, validateSkills, validateRetell } from "../src/lib/ai.js";
import { splitBulk, wikiHtmlToText, suggest } from "../src/parent.js";
import { checkStory } from "../src/pipeline.js";
import { parseStory, isQuotaError } from "../src/lib/ai.js";
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

test("validateQuestions: code places the right text, task flag links the purpose", () => {
  const body = "第一段讲小狗。\n第二段讲小猫。\n第三段讲小鸟。";
  const ok = validateQuestions({
    purpose: { task: "留意有几种动物", question: { ability: "infer", prompt: "一共几种？", right: "三", wrong: ["一", "二"], evidence: 9 } },
    questions: [
      { ability: "extract", prompt: "第一段讲谁？", right: "小狗", wrong: ["小猫", "小鸟"], evidence: 1 },
      { ability: "extract", prompt: "第二段讲谁？", right: "小猫", wrong: ["小狗", "小鸟"], evidence: 2 },
    ],
    guess: { word: "小鸟", right: "鸟", wrong: ["猫", "狗"] },
  }, body);
  assert.deepEqual(ok.questions.map((q) => q.options[q.answer]), ["三", "小狗", "小猫"]);
  assert.equal(ok.questions[1].evidence, 0);
  assert.equal(ok.questions[0].evidence, null);
  assert.deepEqual(ok.purpose, { task: "留意有几种动物", q: 0 }); // the task's own question, first
  assert.equal(ok.guess.options[ok.guess.answer], "鸟");
  assert.equal(ok.guess.evidence, 2);
  assert.throws(() => validateQuestions({ questions: [{ prompt: "x", right: "a", wrong: ["a", "b"] }] }, body), /different/);
  assert.equal(validateQuestions({ purpose: { task: "无对应题" }, questions: ok.questions.map(() => ({ prompt: "x", right: "a", wrong: ["b", "c"] })) }, body).purpose, null);
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

test("splitSentences reassembles exactly; locateSentence finds the evidence", () => {
  const p = "他说：“你好！”我点点头。真的吗？没有结尾";
  assert.equal(splitSentences(p).join(""), p);
  assert.deepEqual(locateSentence(["第一段。", "阿嗅低头一看，书上有个字。它不认识这个字！"], "它不认识这个字"), { para: 1, sentence: 1 });
  assert.equal(locateSentence(["第一段。"], "原文里没有的句子啊"), null);
});

test("validateSkills: positions, exact evidence, contiguous sections", () => {
  const body = ["小狐狸饿了，想吃葡萄。", "葡萄挂得很高，它跳了好几次。", "它还是够不着葡萄。", "它说葡萄是酸的。", "然后它走开了。", "大家都笑了。"].join("\n");
  const good = {
    predict: { after: 2, prompt: "接下来会怎样？", happens: "放弃了", alternatives: ["够着了", "找梯子"], reveal: 4, explain: "它说葡萄酸" },
    locate: [{ prompt: "小狐狸为什么说葡萄酸？", evidence: "它还是够不着葡萄", answer_text: "因为够不着" }],
    sections: [{ from: 1, to: 2, summary: "想吃", distractors: ["下雨", "睡觉"] }, { from: 3, to: 4, summary: "够不着", distractors: ["吃到了", "回家"] }, { from: 5, to: 6, summary: "走开", distractors: ["飞走", "唱歌"] }],
  };
  const out = validateSkills(good, body, true);
  const loc = out.find((x) => x.kind === "locate");
  assert.equal(loc.answer, 200); // paragraph 3, sentence 1
  assert.deepEqual(out.find((x) => x.kind === "predict").meta, { after: 1, reveal: 3 });
  const secs = out.filter((x) => x.kind === "section");
  assert.equal(secs.length, 3);
  // the right text is always where `answer` points, and positions vary
  assert.deepEqual(secs.map((x) => x.options[x.answer]), ["想吃", "够不着", "走开"]);
  assert.ok(new Set(secs.map((x) => x.answer)).size > 1);
  const pr = out.find((x) => x.kind === "predict");
  assert.equal(pr.options[pr.answer], "放弃了");
  assert.ok(!validateSkills(good, body, false).some((x) => x.kind === "predict")); // non-narrative: no prediction
  assert.throws(() => validateSkills({ ...good, sections: [good.sections[0], good.sections[2], good.sections[1]] }, body, true), /does not continue/);
  assert.throws(() => validateSkills({ ...good, locate: [{ prompt: "?", evidence: "原文没有这句话呀" }] }, body, true), /copied exactly/);
  // a broken prediction is dropped, not fatal
  assert.ok(!validateSkills({ ...good, predict: { ...good.predict, reveal: 1 } }, body, true).some((x) => x.kind === "predict"));
});

test("validateRetell matches covered points by text, never by index", () => {
  const pts = ["阿嗅闻到墨香", "阿嗅猜出森字", "阿嗅每天来读书"];
  const r = validateRetell({ covered: ["阿嗅猜出森字", "每天来读书", "1", "编出来的要点"], feedback: "讲得好", tip: "" }, pts);
  assert.deepEqual(r.covered, ["阿嗅猜出森字", "阿嗅每天来读书"]);
  assert.equal(validateRetell({ covered: [] }, pts).covered.length, 0);
});

test("checkStory counts characters beyond the known set and the targets", () => {
  const known = new Set([..."我们去公园玩了很开心小狗跑"]);
  const c = checkStory({ body: "我们去公园玩了，小狗跑得很开心。乐乐踢球。".repeat(40) }, known, new Set([..."乐"]));
  assert.deepEqual(c.extra.sort(), ["球", "踢", "得"].sort());
  assert.equal(c.ok, true); // 3 extra, length in range
  assert.equal(checkStory({ body: "我们去公园。" }, known, new Set()).ok, false); // too short
});

test("parseStory: first line title, markdown and 《》 stripped", () => {
  const st = parseStory("## 《乐乐找小狗》\n\n**第一段。**\n第二段。\n第三段。\n第四段。");
  assert.equal(st.title, "乐乐找小狗");
  assert.equal(st.body.split("\n")[0], "第一段。");
});

test("isQuotaError recognises the Workers AI daily allocation error", () => {
  assert.ok(isQuotaError(new Error("4006: you have used up your daily free allocation of 10,000 neurons")));
  assert.ok(!isQuotaError(new Error("5028: model deprecated")));
  assert.ok(!isQuotaError(new Error("q1: bad prompt")));
});

import { compareReading } from "../src/lib/fluency.js";
test("fluency: homophones from the recogniser are not reading errors; skipped words are", () => {
  const p = "阿嗅是一只小猎犬，耳朵长长的，鼻子特别灵。";
  const py = annotate(p);
  // recogniser wrote 阿秀 / 小獵犬 (traditional) / 耳多: same syllables → all correct
  const perfect = compareReading(p, py, "阿秀是一隻小獵犬耳多長長的鼻子特別靈", 6000);
  assert.equal(perfect.accuracy, 1);
  assert.equal(perfect.missed.length, 0);
  // skipped 耳朵长长的
  const skipped = compareReading(p, py, "阿嗅是一只小猎犬鼻子特别灵", 5000);
  assert.deepEqual(skipped.practise, ["耳朵长长的"]);
  assert.equal(skipped.accuracy, Math.round((13 / 18) * 100) / 100);
  assert.equal(perfect.cpm, Math.round(18 / 0.1));
});

import { extract } from "../scripts/import.mjs";
test("import: web page extraction keeps the story paragraphs, drops boilerplate", () => {
  const html = `<html><head><title>小蝌蚪找妈妈_儿童故事网</title><script>var x="不要我";</script></head><body>
    <nav>首页 故事 童话</nav><h1>小蝌蚪找妈妈</h1>
    <p>池塘里有一群小蝌蚪，大大的脑袋，黑灰色的身子，甩着长长的尾巴，快活地游来游去。</p>
    <p>小蝌蚪游哇游，过了几天，长出两条后腿。他们看见鲤鱼妈妈在教小鲤鱼捕食。</p>
    <p>上一篇：小猫钓鱼</p><footer>版权所有 2026</footer></body></html>`;
  const r = extract(html);
  assert.equal(r.title, "小蝌蚪找妈妈");
  assert.equal(r.body.split("\n").length, 2);
  assert.ok(!r.body.includes("上一篇"));
});

import { splitLong } from "../src/lib/split.js";
test("split: long texts become parts of about 1000 chars at paragraph ends; short ones stay whole", () => {
  const para = (n) => "字".repeat(n - 1) + "。";
  assert.equal(splitLong(para(700)).length, 1);
  const text = Array.from({ length: 38 }, (_, i) => para(60 + ((i * 37) % 90))).join("\n");
  const parts = splitLong(text);
  assert.ok(parts.length >= 3 && parts.length <= 5);
  for (const p of parts) assert.ok(p.replace(/\n/g, "").length <= 1600 && p.replace(/\n/g, "").length >= 350);
  assert.equal(parts.join("\n"), text); // nothing lost, order kept
  // one huge paragraph is cut at sentence ends
  const big = Array.from({ length: 200 }, () => "小坡跑到海边去看大船。").join("");
  assert.ok(splitLong(big).length >= 2);
});

test("wikisource: header box, notes and sister links are not part of the text", () => {
  const html = `<div class="mw-parser-output"><div align="left"><small>更多资料：<a>春</a></small></div><div id="headerContainer"><table><tr><td>落花生 作者：許地山</td></tr></table>
    <div class="x">署名「落華生」發表<ul id="plainSister"><li>姊妹计划: 数据项</li></ul></div></div>
    <p>&#8203;我們屋後有半畝隙地。母親說：「讓他荒蕪着怪可惜。」</p><p>&#160;一</p><p>目录</p><p>爹爹說：「這是我對於你們底希望。」</p></div>`;
  const t = wikiHtmlToText(html);
  assert.equal(t, "我們屋後有半畝隙地。母親說：「讓他荒蕪着怪可惜。」\n爹爹說：「這是我對於你們底希望。」");
});

import { extract as extractPage } from "../src/lib/extract.js";
test("import: WeChat articles read from #js_content", () => {
  const html = `<html><head><meta property="og:title" content="小猫钓鱼"></head><body><div id="js_content"><section><span>猫妈妈带着小猫在河边钓鱼。一只蜻蜓飞来了，小猫放下鱼竿就去捉蜻蜓。</span></section>
    <section>蜻蜓飞走了，小猫空着手回到河边，看见猫妈妈钓到了一条大鱼。</section><section>点击关注我们的公众号</section></div><script>var x=1;</script></body></html>`;
  const r = extractPage(html);
  assert.equal(r.title, "小猫钓鱼");
  assert.equal(r.body.split("\n").length, 2);
});

test("pick: the next part of a story already begun ranks first among equals", () => {
  const ctx = { known: new Set("小猫在河边钓鱼"), due: new Set(), upcoming: new Set(), recentGenres: [], targetNew: 2 };
  const base = { uniq: "小猫在河边钓鱼蜻蜓", difficulty: 20, genre: "story", tags: [], charCount: 800 };
  const r = rankCandidates([{ ...base, id: 1, title: "甲" }, { ...base, id: 2, title: "乙（二）", continues: true }], ctx);
  assert.equal(r[0].id, 2);
});
