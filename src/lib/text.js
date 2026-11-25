// Text analysis: the hard metrics of §5, computed in code so they are
// reproducible. Nothing here calls a model.
import { CHARS_BY_FREQ } from "../data/charlevels.js";
import { RECOGNISE, WRITE } from "../data/textbook.js";
import { Converter } from "opencc-js/t2cn";

// Traditional → simplified. Public-domain sources (wikisource, older
// editions) are often traditional; analysing them unconverted counts
// pure glyph variants as "new" characters and badly overstates difficulty.
const toSimplified = Converter({ from: "t", to: "cn" });

/**
 * The level order of characters: 统编版 textbook characters by the volume
 * in which they must first be recognised (一上 … 六下; frequency breaks ties
 * inside a volume), then the remaining 通用规范汉字表 level-1 characters by
 * corpus frequency. A character's rank in this order is how "late" a child
 * normally meets it; every grade, coverage and assessment rule derives from it.
 */
export const VOLUME_NAMES = ["一年级上册", "一年级下册", "二年级上册", "二年级下册", "三年级上册", "三年级下册",
  "四年级上册", "四年级下册", "五年级上册", "五年级下册", "六年级上册", "六年级下册"];
const FREQ = new Map();
for (let i = 0; i < CHARS_BY_FREQ.length; i++) FREQ.set(CHARS_BY_FREQ[i], i + 1);
const freqOf = (ch) => FREQ.get(ch) || 1e6 + ch.codePointAt(0);
const RECOG_VOL = new Map(), WRITE_VOL = new Map();
RECOGNISE.forEach((s, v) => { for (const ch of s) RECOG_VOL.set(ch, v + 1); });
WRITE.forEach((s, v) => { for (const ch of s) WRITE_VOL.set(ch, v + 1); });

export const LEVEL_ORDER = [
  ...[...RECOG_VOL.keys()].sort((a, b) => RECOG_VOL.get(a) - RECOG_VOL.get(b) || freqOf(a) - freqOf(b)),
  ...[...CHARS_BY_FREQ].filter((ch) => !RECOG_VOL.has(ch)),
];
const RANK = new Map(LEVEL_ORDER.map((ch, i) => [ch, i + 1]));
export const OUTSIDE_RANK = 9999;
/** Position in the level order (1-based); 9999 if outside both lists. */
export function rankOf(ch) {
  return RANK.get(ch) || OUTSIDE_RANK;
}
/** Last rank of everything worth teaching (textbook + common characters). */
export const MAX_RANK = LEVEL_ORDER.length;

/** Cumulative rank at the end of each textbook volume (1-based volumes). */
export const VOLUME_END = RECOGNISE.reduce((acc, s) => [...acc, (acc[acc.length - 1] || 0) + [...s].length], []);
/** End of grade 4 (四年级下册): the "grades 1-4" coverage baseline. */
export const GRADE4_RANK = VOLUME_END[7];

export function gradeOf(ch) {
  const v = RECOG_VOL.get(ch);
  return v ? Math.ceil(v / 2) : 7; // 7 = not in the primary textbooks
}

/** Where the textbooks introduce a character: {recognise, write} as volume names (or null). */
export function textbookInfo(ch) {
  const r = RECOG_VOL.get(ch), w = WRITE_VOL.get(ch);
  return { recognise: r ? VOLUME_NAMES[r - 1] : null, write: w ? VOLUME_NAMES[w - 1] : null };
}

/**
 * Characters every reader has seen hundreds of times (一年级上册). They are
 * not worth an encounter row ("where did I see 的?") — keeps char_encounters small.
 */
export const CORE_RANK = 300;

const HAN = /\p{Script=Han}/u;
export function isHan(ch) {
  return HAN.test(ch);
}

/** Normalise raw text: simplified script, unified line endings, no empty paragraphs. */
export function normalise(raw) {
  return toSimplified(String(raw || ""))
    .replace(/\r\n?/g, "\n")
    .replace(/[　\t ]+/g, (m) => (m.includes("　") ? "" : " "))
    .split("\n")
    .map((p) => p.trim())
    .filter(Boolean)
    .join("\n");
}

export function paragraphs(text) {
  return normalise(text).split("\n");
}

/** Split into sentences on Chinese terminal punctuation (keeps closing quotes). */
export function sentences(text) {
  const out = [];
  for (const para of paragraphs(text)) {
    const parts = para.match(/[^。！？!?…]+(?:[。！？!?…]+[”’」』）)]*)?/g) || [];
    for (const s of parts) if (countHan(s) > 0) out.push(s.trim());
  }
  return out;
}

export function countHan(s) {
  let n = 0;
  for (const ch of s) if (isHan(ch)) n++;
  return n;
}

/** Map of Han character -> occurrences. */
export function charCounts(text) {
  const m = new Map();
  for (const ch of text) if (isHan(ch)) m.set(ch, (m.get(ch) || 0) + 1);
  return m;
}

/**
 * Child-independent metrics, stored on the article at ingest time.
 * coverage: share of Han chars (by occurrence) the textbooks teach by the end of grade 4.
 */
export function articleMetrics(text) {
  const counts = charCounts(text);
  let total = 0, inGrade4 = 0, rareOcc = 0;
  for (const [ch, n] of counts) {
    total += n;
    const r = rankOf(ch);
    if (r <= GRADE4_RANK) inGrade4 += n;
    if (r > MAX_RANK) rareOcc += n;
  }
  const sents = sentences(text).map(countHan);
  const avgSentence = sents.length ? sents.reduce((a, b) => a + b, 0) / sents.length : 0;
  const maxSentence = sents.length ? Math.max(...sents) : 0;
  const coverage = total ? inGrade4 / total : 0;
  return {
    charCount: total,
    uniqueChars: counts.size,
    paragraphCount: paragraphs(text).length,
    coverage: round(coverage, 4),
    rareDensity: total ? round((rareOcc / total) * 100, 2) : 0,
    avgSentenceLen: round(avgSentence, 1),
    maxSentenceLen: maxSentence,
    difficulty: baseDifficulty({ coverage, avgSentence, maxSentence, total }),
    uniq: [...counts.keys()].join(""),
  };
}

/**
 * Composite 0-100 difficulty for an average grade-4 reader:
 * vocabulary (coverage) dominates, sentence length second, length third.
 */
export function baseDifficulty({ coverage, avgSentence, maxSentence, total }) {
  const vocab = clamp((1 - coverage) / 0.12, 0, 1); // 88% coverage => max
  const sent = clamp((avgSentence - 10) / 25, 0, 1) * 0.7 + clamp((maxSentence - 25) / 60, 0, 1) * 0.3;
  const len = clamp((total - 400) / 1600, 0, 1);
  return Math.round(100 * (0.6 * vocab + 0.3 * sent + 0.1 * len));
}

/** Grade-4 parameters (§9). Parents can tune via settings. */
export const DEFAULT_PARAMS = {
  minChars: 300, // hard floor / ceiling for ingest (ideal 600-900)
  maxChars: 1600,
  idealMin: 600,
  idealMax: 900,
  minCoverage: 0.86,
  // children's story text sits around 20-23 (samples/); adult explanatory
  // prose ~31 (difficulty-sample-2026-11-25.md §2) — reject above 28
  maxAvgSentence: 28,
  maxDifficulty: 75,
  targetNew: 5, // new characters per article
};

/** Ingest-time screening on hard metrics. Returns list of rejection reasons. */
export function hardScreen(m, params = DEFAULT_PARAMS) {
  const why = [];
  if (m.charCount < params.minChars) why.push(`太短（${m.charCount} 字）`);
  if (m.charCount > params.maxChars) why.push(`太长（${m.charCount} 字）`);
  if (m.coverage < params.minCoverage) why.push(`常用字覆盖率低（${pct(m.coverage)}）`);
  if (m.avgSentenceLen > params.maxAvgSentence) why.push(`句子太长（平均 ${m.avgSentenceLen} 字）`);
  if (m.difficulty > params.maxDifficulty) why.push(`综合难度过高（${m.difficulty}）`);
  return why;
}

/**
 * Personal analysis against the child's known set: which characters are
 * new for *this* child. Ordered by first appearance; capped list of the
 * ones worth teaching (excludes rare chars outside level 1 — those get a
 * pinyin crutch but are not targets).
 */
export function newCharsFor(uniq, known) {
  const all = [];
  for (const ch of uniq) if (!known.has(ch)) all.push(ch);
  const teachable = all.filter((ch) => rankOf(ch) <= MAX_RANK);
  return { all, teachable };
}

/**
 * Personal verdict on new-character count (difficulty-sample-2026-11-25.md §0,
 * proposal §9 "约 5 个新字"): PASS ≤8, REVIEW ≤15, otherwise not yet —
 * the article stays in the library until the known set catches up.
 */
export const TIER_LIMITS = { pass: 8, review: 15 };
export function newTier(n) {
  return n <= TIER_LIMITS.pass ? "pass" : n <= TIER_LIMITS.review ? "review" : "later";
}

export function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}
export function round(x, d) {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}
function pct(x) {
  return `${Math.round(x * 100)}%`;
}
