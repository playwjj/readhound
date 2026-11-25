// 朗读流利度 (phase 3): compare what the child read aloud with the paragraph.
// Speech recognition writes the most likely *characters*, so a correctly read
// syllable may come back as a homophone. Comparing toneless pinyin instead of
// characters means the child is never marked wrong for the recogniser's
// choice of character.
import { pinyin } from "pinyin-pro";
import { isHan } from "./text.js";

const toneless = (py) => py.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ü|ü/g, "v").toLowerCase();

/** Toneless syllables of the Han characters in `text`. */
export function syllablesOf(text) {
  const items = pinyin(text, { type: "all", toneType: "none" });
  return items.filter((it) => isHan(it.origin)).map((it) => toneless(it.pinyin || ""));
}

/** Longest common subsequence: which expected positions were heard, in order. */
function lcsMatch(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const matched = new Set();
  for (let i = 0, j = 0; i < n && j < m;) {
    if (a[i] === b[j]) { matched.add(i); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return matched;
}

/**
 * paragraph: the text; expectedPinyin: its stored syllables (space-separated,
 * polyphones already corrected); transcript: what the recogniser heard;
 * ms: recording length.
 */
export function compareReading(paragraph, expectedPinyin, transcript, ms) {
  const chars = [...paragraph].filter(isHan);
  const stored = String(expectedPinyin || "").split(" ").filter(Boolean);
  const expected = stored.length === chars.length ? stored.map(toneless) : syllablesOf(paragraph);
  const heard = syllablesOf(transcript);
  const matched = lcsMatch(expected, heard);
  const missed = [];
  chars.forEach((ch, i) => { if (!matched.has(i)) missed.push({ index: i, char: ch }); });
  const minutes = Math.max(ms, 1000) / 60000;
  return {
    accuracy: chars.length ? Math.round((matched.size / chars.length) * 100) / 100 : 0,
    cpm: Math.round(chars.length / minutes), // characters per minute
    total: chars.length,
    missed,
    // nearby missed characters grouped into words to practise
    practise: groupMissed(chars, missed).slice(0, 6),
  };
}

function groupMissed(chars, missed) {
  const groups = [];
  for (const m of missed) {
    const last = groups[groups.length - 1];
    if (last && m.index - last.end <= 1) { last.text += chars.slice(last.end + 1, m.index + 1).join(""); last.end = m.index; }
    else groups.push({ start: m.index, end: m.index, text: m.char });
  }
  return groups.filter((g) => g.text.length <= 8).map((g) => g.text);
}
