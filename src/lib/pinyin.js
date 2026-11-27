// Pinyin annotation (pinyin-pro, context-aware for polyphones).
// Computed once at ingest; the reading path only serves stored strings.
import { pinyin } from "pinyin-pro";
import { isHan } from "./text.js";

/**
 * Annotate one paragraph: returns pinyin for each Han char, in order,
 * joined by spaces. Non-Han characters are skipped, so the client aligns
 * by walking the paragraph and consuming one syllable per Han char.
 */
export function annotate(paragraph) {
  const items = pinyin(paragraph, { type: "all" });
  const out = [];
  for (const it of items) if (isHan(it.origin)) out.push(it.pinyin || "");
  return fixParticles(paragraph, out.join(" "));
}

// ---------------------------------------------------------------- particles
// pinyin-pro gets the structural particles wrong in running text (跑得 dé,
// 慢慢地 dì, 看着 zhuó, 只不过 zhī, 不应该 bú — sampled on production
// articles 2026-11-27), and these characters skip the model check. Fixed
// here by rule, from the neighbouring characters.
const NUMERAL = new Set([..."零〇一二两三四五六七八九十百千万几"]);
const DE_DE_NEXT = new Set([..."到罪意分奖病救逞失体力手知以胜益宠势志"]); // 得到 得罪 …
const DE_DE_PREV = new Set([..."获取赢博难心所求"]); // 获得 难得 心得 …
const DEI_PREV = new Set([..."还非就总必"]); // 还得 非得 …
const BU_DE_SOFT = new Set([..."恨舍怪巴记顾免了"]); // 恨不得 舍不得 … (bu de)
const DI_PREV = new Set([..."天土大田草遍落隙园山陆平高低雪荒本外各当耕盆基领境场墓林腹空极盆湿洼工营圣宝福旱沙绿实阵"]);
const DI_NEXT = new Set([..."面上下方球图区点址震里板毯底带位步主铁道势形质壳狱盘基窖洞头"]);
const ZHAO_NEXT = new Set([..."急火凉迷慌"]); // 着急 着火 …
const ZHUO_NEXT = new Set([..."手装陆想重落色实力笔墨"]); // 着手 着陆 着想 …
const ZHUO_LEAD = new Set([..."从就便即先已再要应须始备来去难上"]); // 从着手 马上着手 …
const ZHUO_PREV = new Set([..."衣执沉附"]); // 衣着 执着 沉着 附着
const ZHI_PREV = new Set([..."一二两三四五六七八九十几每这那哪半单某"]);
const ZHI_NOT_NEXT = new Set([..."是要有好能会不在说把得管顾见剩怕许"]); // 这只是 … → zhǐ
const LIAO_NEXT = new Set([..."解结却断然悟如"]); // 了解 了结 …

function toneOf(syl) {
  for (const ch of syl || "") {
    if ("āēīōūǖ".includes(ch)) return 1;
    if ("áéíóúǘ".includes(ch)) return 2;
    if ("ǎěǐǒǔǚ".includes(ch)) return 3;
    if ("àèìòùǜ".includes(ch)) return 4;
  }
  return 0;
}

/**
 * Correct the particles in one paragraph's syllables (space-joined, one per
 * Han char). only: limit to these characters (a stored article keeps the
 * model's and the parent's corrections for everything else).
 */
export function fixParticles(paragraph, syllables, { only = null } = {}) {
  const chars = [...paragraph];
  const syl = syllables.split(" ");
  const han = []; // Han index → char index
  chars.forEach((c, j) => { if (isHan(c)) han.push(j); });
  if (han.length !== syl.length) return syllables; // misaligned: leave as is
  // the Han neighbours of Han index h, null across punctuation
  const at = (h, d) => {
    const k = h + d;
    if (k < 0 || k >= han.length || Math.abs(han[k] - han[h]) !== Math.abs(d)) return null;
    return chars[han[k]];
  };
  const pass = (fn) => syl.forEach((_, h) => {
    const c = chars[han[h]];
    if (only && !only.has(c)) return;
    const r = fn(c, h);
    if (r) syl[h] = r;
  });
  // 1. particles and readings decided by their words
  pass((c, h) => {
    const p = at(h, -1), pp = at(h, -2), n = at(h, 1);
    switch (c) {
      case "得":
        if (n && DE_DE_NEXT.has(n)) return "dé";
        if (n === "了" && p !== "不") return at(h + 1, 1) ? "dé" : "de"; // 得了急病 / 受得了。
        if (!p) return "dé";
        if (p === "不") return pp && BU_DE_SOFT.has(pp) ? "de" : "dé";
        if (DE_DE_PREV.has(p)) return "dé";
        if (DEI_PREV.has(p) && n) return "děi";
        return "de";
      case "地":
        if (!p || !n) return "dì"; // 地上… / …踩着地。
        if (p && p === pp) return "de"; // 慢慢地 呼呼地 大大地
        if (DI_PREV.has(p) || DI_NEXT.has(n) || "和与跟同及或".includes(p)) return "dì"; // 天和地
        return "de";
      case "着":
        if (n && ZHAO_NEXT.has(n)) return "zháo";
        if (p === "不" || (p === "得" && pp)) return "zháo"; // 找不着 用得着
        // 着手 着重 … only where 着 opens the word (看着手中的泥 is zhe)
        if (n && ZHUO_NEXT.has(n) && (!p || ZHUO_LEAD.has(p) || n === "陆" || (n === "想" && p !== "想"))) return "zhuó";
        if (p && ZHUO_PREV.has(p)) return "zhuó";
        if (p === "睡" && n === "了") return "zháo";
        return "zhe";
      case "了":
        if (n && LIAO_NEXT.has(n)) return "liǎo";
        if (n === "不" && at(h, 2) === "起") return "liǎo"; // 了不起
        if (p === "不") return "liǎo"; // 受不了 过不了
        if (p === "得" && pp !== "不" && (!n || "吗吧呢啊呀么".includes(n))) return "liǎo"; // 受得了。(not 得了急病, 等不得了)
        return "le";
      case "只":
        if (p && ZHI_PREV.has(p) && n && !ZHI_NOT_NEXT.has(n)) return "zhī"; // 两只耳朵
        return "zhǐ";
    }
    return null;
  });
  // 2. tone sandhi of 一 and 不, from the next syllable as now annotated
  const BASE = { 一: 1, 不: 4 };
  pass((c, h) => {
    if (c !== "一" && c !== "不") return null;
    const p = at(h, -1), n = at(h, 1);
    if (c === "一") {
      if (!n || p === "第" || (p && NUMERAL.has(p)) || (NUMERAL.has(n) && !"百千万亿".includes(n)) || (p && "统唯万初".includes(p))) return "yī"; // 一万 keeps the sandhi
      if (n === "月" || n === "号" || (n === "年" && at(h, 2) === "级") || n === "级" || n === "等") return "yī"; // 一月 一年级 一等奖
      if (p && p === n && at(h, -2) !== "一") return "yi"; // 试一试 (not 一个一个)
    } else if (syl[h] === "bu" || (p && p === n)) return "bu"; // 好不好
    if (!n) return c === "一" ? "yī" : "bù";
    const t = BASE[n] || toneOf(syl[h + 1]);
    if (c === "一") return t === 4 || t === 0 ? "yí" : "yì";
    return t === 4 ? "bú" : "bù";
  });
  return syl.join(" ");
}

/** The characters fixParticles decides (for re-processing stored pinyin). */
export const PARTICLE_CHARS = new Set([..."得地着了一不"]);

/** The reading of `ch` as used at position `index` of `text` (falls back to default). */
export function readingAt(text, index) {
  const chars = [...text];
  const items = pinyin(text, { type: "all" });
  // pinyin-pro returns one item per code point for Han text
  if (items.length === chars.length && items[index]) return items[index].pinyin;
  return pinyin(chars[index] || "");
}

/**
 * Polyphones pinyin-pro is reliably right about (particles, 一/不 tone sandhi):
 * not worth a model call.
 */
const TRUSTED = new Set([..."的了着地得么个们子头一不吗呢吧啊呀哪那这里上下过来去为和"]);

/**
 * Polyphonic characters in a paragraph worth checking: index in the Han
 * sequence (same index as annotate()), the chosen reading, all candidates and
 * a short context window.
 */
export function polyphonesIn(paragraph) {
  const items = pinyin(paragraph, { type: "all" });
  const out = [];
  let k = 0;
  items.forEach((it, pos) => {
    if (!isHan(it.origin)) return;
    const cands = [...new Set(it.polyphonic || [])];
    if (cands.length > 1 && !TRUSTED.has(it.origin)) {
      // mark the target: the same character often appears twice in one window (长着…又长又硬)
      const before = items.slice(Math.max(0, pos - 8), pos).map((x) => x.origin).join("");
      const after = items.slice(pos + 1, pos + 9).map((x) => x.origin).join("");
      const ctx = `${before}【${it.origin}】${after}`;
      out.push({ index: k, char: it.origin, reading: it.pinyin, candidates: cands, context: ctx });
    }
    k++;
  });
  return out;
}

/**
 * Apply parent word fixes ({word, pinyin: "zhǎng zhe"}) to one paragraph's
 * syllables. Fixes win over both pinyin-pro and the model.
 */
export function applyFixes(paragraph, syllables, fixes) {
  if (!fixes || !fixes.length) return syllables;
  const syl = syllables.split(" ");
  const hanIndex = []; // code-point position → Han index
  let k = 0;
  for (const ch of paragraph) hanIndex.push(isHan(ch) ? k++ : -1);
  const chars = [...paragraph];
  for (const f of fixes) {
    const w = [...f.word], py = String(f.pinyin).trim().split(/\s+/);
    if (w.length !== py.length || !w.every(isHan)) continue;
    for (let i = 0; i + w.length <= chars.length; i++) {
      if (w.every((c, j) => chars[i + j] === c)) w.forEach((_, j) => { syl[hanIndex[i + j]] = py[j]; });
    }
  }
  return syl.join(" ");
}

export function readingOf(ch) {
  return pinyin(ch);
}

const TONES = {
  a: "aāáǎà", e: "eēéěè", i: "iīíǐì", o: "oōóǒò", u: "uūúǔù", ü: "üǖǘǚǜ",
};
const TONE_TO_BASE = {};
for (const [base, row] of Object.entries(TONES)) for (let t = 0; t < row.length; t++) TONE_TO_BASE[row[t]] = [base, t];

/** All tone variants of a syllable (same letters, tone 1-4), excluding itself. */
export function toneVariants(py) {
  const chars = [...py];
  const idx = chars.findIndex((c) => TONE_TO_BASE[c] && TONE_TO_BASE[c][1] > 0);
  if (idx < 0) return [];
  const [base, tone] = TONE_TO_BASE[chars[idx]];
  const res = [];
  for (let t = 1; t <= 4; t++) {
    if (t === tone) continue;
    const c = chars.slice();
    c[idx] = TONES[base][t];
    res.push(c.join(""));
  }
  return res;
}

/**
 * Build a 3-option pinyin choice for a character quiz: the right reading,
 * one tone variant (tests tone) and one reading of a different character
 * (tests recognition). Deterministic given `seed`.
 */
export function pinyinChoices(answer, otherReadings, seed = 0, alsoValid = new Set()) {
  const opts = new Set([answer]);
  // never offer another valid reading of the same character as a distractor
  const tv = toneVariants(answer).filter((v) => !alsoValid.has(v));
  otherReadings = otherReadings.filter((r) => !alsoValid.has(r));
  if (tv.length) opts.add(tv[seed % tv.length]);
  for (const r of otherReadings) {
    if (opts.size >= 3) break;
    if (r && !opts.has(r)) opts.add(r);
  }
  for (const v of tv) {
    if (opts.size >= 3) break;
    opts.add(v);
  }
  const arr = [...opts];
  // rotate deterministically so the answer is not always first
  const k = seed % arr.length;
  return arr.slice(k).concat(arr.slice(0, k));
}

export { isHan };
