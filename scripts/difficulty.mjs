// Run the difficulty engine on text files, the way the ingest pipeline does.
// Reproduces the columns of difficulty-sample-2026-11-25.md.
//
//   node scripts/difficulty.mjs [--volume 8 | --known wordlist.csv | --rank 2500] [--json] file.txt ...
//
// --known  any text/CSV file: every Han character in it counts as known
//          (e.g. a textbook 识字表 / 写字表 export)
// --volume known = every character the 统编版 textbooks require to be
//          recognised up to volume N (1 = 一上 … 8 = 四下; default 8)
// --rank   known = the N most frequent of the 3500 common characters
// The first line of each file is taken as the title when it is short.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { articleMetrics, hardScreen, newCharsFor, newTier, charCounts, normalise, isHan } from "../src/lib/text.js";

const { CHARS_BY_FREQ } = await import("../src/data/charlevels.js");
const { RECOGNISE } = await import("../src/data/textbook.js");
const { VOLUME_NAMES } = await import("../src/lib/text.js");
const args = process.argv.slice(2);
let known = null, label = "", json = false, rankN = 0, volume = 8;
const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--known") {
    const path = args[++i];
    known = new Set([...normalise(readFileSync(path, "utf8"))].filter(isHan));
    label = `${basename(path)}（${known.size} 字）`;
  } else if (args[i] === "--rank") rankN = Number(args[++i]);
  else if (args[i] === "--volume") volume = Number(args[++i]);
  else if (args[i] === "--json") json = true;
  else files.push(args[i]);
}
if (!known && rankN) {
  known = new Set([...CHARS_BY_FREQ.slice(0, rankN)]);
  label = `字频前 ${rankN}`;
} else if (!known) {
  known = new Set([...RECOGNISE.slice(0, volume).join("")]);
  label = `统编版识字表 一上–${VOLUME_NAMES[volume - 1]}（${known.size} 字）`;
}
if (!files.length) {
  console.error("usage: node scripts/difficulty.mjs [--known list.csv | --rank N] [--json] file.txt ...");
  process.exit(1);
}

function analyse(raw) {
  const m = articleMetrics(raw);
  const counts = charCounts(raw);
  let total = 0, inKnown = 0, newOcc = 0;
  for (const [ch, n] of counts) {
    total += n;
    if (known.has(ch)) inKnown += n;
    else newOcc += n;
  }
  const { all, teachable } = newCharsFor(m.uniq, known);
  return {
    chars: m.charCount,
    knownCoverage: total ? +(inKnown / total * 100).toFixed(2) : 0,
    newTypes: all.length,
    teachable: teachable.length,
    newOcc,
    newPer100: total ? +(newOcc / total * 100).toFixed(2) : 0,
    avgSentence: m.avgSentenceLen,
    maxSentence: m.maxSentenceLen,
    grade4Coverage: +(m.coverage * 100).toFixed(2),
    difficulty: m.difficulty,
    tier: newTier(teachable.length),
    hardScreen: hardScreen(m),
    topNew: [...counts].filter(([c]) => !known.has(c)).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([c, n]) => (n > 1 ? `${c}×${n}` : c)),
  };
}

const out = [];
for (const f of files) {
  let text = readFileSync(f, "utf8");
  const lines = text.split("\n");
  let title = basename(f);
  if (lines.length > 1 && [...lines[0].trim()].length <= 20) {
    title = lines[0].trim();
    text = lines.slice(1).join("\n");
  }
  const raw = text.replace(/\r\n?/g, "\n");
  const simplified = normalise(raw);
  const changed = simplified.replace(/\n/g, "") !== raw.replace(/\s+/g, "");
  out.push({ file: f, title, before: changed ? analyse(raw) : null, after: analyse(simplified) });
}

if (json) {
  console.log(JSON.stringify({ baseline: label, results: out }, null, 2));
} else {
  const TIER = { pass: "PASS", review: "REVIEW", later: "暂缓（REJECT）" };
  console.log(`基线：${label}；判定：生字 ≤8 PASS，≤15 REVIEW，其余暂缓\n`);
  for (const r of out) {
    const a = r.after;
    console.log(`《${r.title}》 ${a.chars} 字  ${r.file}`);
    if (r.before) console.log(`  繁简归一前：覆盖率 ${r.before.knownCoverage}%，生字 ${r.before.newTypes} 种 / ${r.before.newOcc} 次 → 归一后生字 ${a.newTypes} 种`);
    console.log(`  已知字覆盖率 ${a.knownCoverage}%   生字 ${a.newTypes} 种（可教 ${a.teachable}）/ ${a.newOcc} 次，每百字 ${a.newPer100}`);
    console.log(`  平均句长 ${a.avgSentence} / 最长句 ${a.maxSentence}   1–4 年级覆盖率 ${a.grade4Coverage}%   综合难度 ${a.difficulty}`);
    console.log(`  对孩子：${TIER[a.tier]}   入库硬指标：${a.hardScreen.length ? "淘汰 — " + a.hardScreen.join("；") : "通过"}`);
    if (a.topNew.length) console.log(`  生字：${a.topNew.join("、")}`);
    console.log();
  }
}
