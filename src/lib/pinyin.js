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
