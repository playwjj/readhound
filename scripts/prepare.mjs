// Prepare articles by hand (no Workers AI): fetch a public-domain text, cut
// it the way the library does, and write one skeleton per part into
// data/prepared/ (never committed). Someone then fills in each skeleton's
// "prepared" block — the same content the pipeline's AI stages would make —
// and scripts/import-prepared.mjs sends the finished files to the library.
//
//   node scripts/prepare.mjs shelf <key> [page]    # a 公版名篇书架 item (src/data/shelf.js); page = chapter index
//   node scripts/prepare.mjs wiki "<page title>"    # any zh.wikisource page
//   node scripts/prepare.mjs check data/prepared/x.json   # report again after editing the body
//
// The printout lists what needs a human decision: hard-metric problems,
// polyphonic characters (pick the reading in context) and the characters
// that may be new for a grade-4 reader (each needs a gloss card).
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { SHELF } from "../src/data/shelf.js";
import { wikiHtmlToText } from "../src/parent.js";
import { splitLong, partLabel } from "../src/lib/split.js";
import { normalise, paragraphs, articleMetrics, hardScreen, rankOf, VOLUME_END, MAX_RANK, DEFAULT_PARAMS } from "../src/lib/text.js";
import { polyphonesIn } from "../src/lib/pinyin.js";

const OUT = new URL("../data/prepared/", import.meta.url);
/** Characters beyond 三年级上册 may be new for a grade-4 reader: those get gloss cards. */
const GLOSS_FROM = VOLUME_END[4];

async function wikisource(title) {
  const url = `https://zh.wikisource.org/w/api.php?action=parse&format=json&formatversion=2&prop=text&disablelimitreport=1&redirects=1&page=${encodeURIComponent(title)}`;
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": "ReadHound/0.1 (family reading app; low-frequency)" } });
      if (res.status === 429) { await new Promise((r) => setTimeout(r, 8000)); continue; }
      const d = await res.json();
      if (d.error) throw new Error(d.error.info);
      return { title: d.parse.title, text: wikiHtmlToText(d.parse.text) };
    } catch (e) {
      if (i === 4) throw e;
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
}

function skeleton({ title, body, genre, source, series, part }) {
  return {
    title, genre, source, series, part, body,
    // filled in by hand; formats = what the AI stages return (see src/lib/ai.js validators)
    prepared: {
      screen: { age_fit: "ok", reason: "", genre, tags: [], note: "" },
      polyphones: {}, // {"<paragraph>:<han index>": "reading"} — only where pinyin-pro is wrong
      glosses: [], // [{char, word, gloss, example}]
      questions: { purpose: { task: "", question: null }, questions: [], guess: null },
      skills: { predict: null, locate: [], sections: [], points: [] },
    },
  };
}

function report(a, file) {
  const m = articleMetrics(a.body);
  const why = hardScreen(m, DEFAULT_PARAMS);
  const paras = paragraphs(a.body);
  console.log(`\n=== ${a.title}  →  ${file}`);
  console.log(`${m.charCount} 字, ${paras.length} 段, 句均 ${m.avgSentenceLen}, 难度 ${m.difficulty}${why.length ? `  ✗ ${why.join("；")}` : "  ✓ 通过硬指标"}`);
  // each paragraph with the reading of every polyphonic character inline: 字{reading@index}
  paras.forEach((p, pi) => {
    const at = new Map(polyphonesIn(p).map((it) => [it.index, it.reading]));
    let k = 0;
    const marked = [...p].map((ch) => (/\p{Script=Han}/u.test(ch) ? (at.has(k) ? `${ch}{${at.get(k)}@${k++}}` : (k++, ch)) : ch)).join("");
    console.log(`[${pi + 1}] ${marked}`);
  });
  const gloss = [...new Set(a.body)].filter((ch) => rankOf(ch) > GLOSS_FROM && rankOf(ch) <= MAX_RANK).sort((x, y) => rankOf(x) - rankOf(y));
  console.log(`生字卡候选 ${gloss.length}: ${gloss.join("")}`);
}

async function main() {
  const [mode, arg, page] = process.argv.slice(2);
  let pages, meta;
  if (mode === "shelf") {
    const it = SHELF.find((x) => x.key === arg);
    if (!it) throw new Error(`no shelf item ${arg}`);
    const idx = page != null ? [Number(page)] : it.pages.map((_, i) => i);
    pages = idx.map((i) => ({ i, title: it.pages[i] }));
    meta = { it };
  } else if (mode === "wiki") {
    pages = [{ i: 0, title: arg }];
    meta = {};
  } else if (mode === "check") {
    for (const f of process.argv.slice(3)) report(JSON.parse(readFileSync(f, "utf8")), f);
    return;
  } else {
    console.error("usage: prepare.mjs shelf <key> [page] | wiki <title> | check <file…>");
    process.exit(1);
  }
  mkdirSync(OUT, { recursive: true });
  for (const pg of pages) {
    const p = await wikisource(pg.title);
    const it = meta.it;
    // the same titles and part numbers as the shelf import, so the two never duplicate
    const base = it ? (it.pages.length > 1 ? `${it.title.replace(/（.*）$/, "")}·${p.title.split("/").pop()}` : it.title) : p.title.replace(/\s*\(.*\)$/, "");
    const parts = splitLong(p.text);
    for (const [k, text] of parts.entries()) {
      const title = normalise(parts.length > 1 ? `${base}（${partLabel(k)}）` : base).replace(/\n/g, " ").trim();
      const a = skeleton({
        title, body: normalise(text), genre: it?.genre || "story",
        source: it ? `维基文库 · ${it.author}` : "维基文库",
        series: it ? `shelf:${it.key}` : parts.length > 1 ? `text:${base}` : null,
        part: it ? pg.i * 100 + k + 1 : parts.length > 1 ? k + 1 : null,
      });
      const file = `${it ? it.key : "wiki"}-${String(pg.i).padStart(2, "0")}-${k + 1}.json`;
      if (existsSync(new URL(file, OUT))) console.log(`(${file} exists — not overwritten)`);
      else writeFileSync(new URL(file, OUT), JSON.stringify(a, null, 2));
      report(a, `data/prepared/${file}`);
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
}
await main();
