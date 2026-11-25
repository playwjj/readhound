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
  return out.join(" ");
}

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
