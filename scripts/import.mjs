// Fill the library of a running ReadHound (production or local) through the
// parent API, so every article goes through the normal pipeline (screening,
// pinyin, questions). Nothing is written to this repository.
//
//   export READHOUND_URL=https://<your-domain>   PARENT_PIN=<parent pin>
//   node scripts/import.mjs urls  list.txt        # web pages, one URL per line (# comments ok)
//   node scripts/import.mjs txt   book.txt        # "=== 标题" separated articles
//   node scripts/import.mjs classics idiom 10     # queue retellings: idiom|myth|fable|fairy|history|science
//
// Web pages are fetched slowly (one every 2 s) with a plain user agent; use
// sites you are happy to read privately (the library never leaves your D1).
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const BASE = (process.env.READHOUND_URL || "http://127.0.0.1:8787").replace(/\/$/, "");

let cookie = "";
async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", "x-rh-area": "parent", cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path}: ${data.error || res.status}`);
  return data;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const han = (s) => (String(s).match(/\p{Script=Han}/gu) || []).length;

import { decode, extract } from "../src/lib/extract.js";
export { extract };

async function importUrls(file) {
  const urls = readFileSync(file, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  for (const [i, url] of urls.entries()) {
    try {
      const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (family reading app; low-frequency)" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { title, body } = extract(decode(new Uint8Array(await res.arrayBuffer()), res.headers.get("content-type") || ""));
      if (han(body) < 200) throw new Error(`only ${han(body)} Chinese characters found — not an article page?`);
      const r = await call("POST", "/api/parent/articles", { title: title || `网页文章 ${i + 1}`, body, source: new URL(url).hostname, kind: "web" });
      console.log(`✓ ${title} (${han(body)} 字) →`, r.duplicate ? `already #${r.duplicate}` : `#${r.id}`);
    } catch (e) {
      console.log(`✗ ${url}: ${e.message}`);
    }
    await sleep(2000);
  }
}

async function main() {
  const PIN = process.env.PARENT_PIN;
  const [mode, arg, arg2] = process.argv.slice(2);
  if (!PIN || !mode) {
    console.error("set READHOUND_URL and PARENT_PIN, then: import.mjs urls <file> | txt <file> | classics <category> [count]");
    process.exit(1);
  }
  await call("POST", "/api/login", { pin: PIN });
  if (mode === "urls") await importUrls(arg);
  else if (mode === "txt") {
    const r = await call("POST", "/api/parent/articles/bulk", { text: readFileSync(arg, "utf8"), source: arg.split("/").pop() });
    for (const x of r.results) console.log(x.error ? `✗ ${x.title}: ${x.error}` : `✓ ${x.title} →`, x.duplicate ? `already #${x.duplicate}` : x.id ? `#${x.id}` : "");
  } else if (mode === "classics") {
    const r = await call("POST", "/api/parent/classics", { category: arg, count: Number(arg2) || 10 });
    console.log(`queued ${r.queued.length}: ${r.queued.join("、")}`);
  } else {
    console.error("unknown mode", mode);
    process.exit(1);
  }
  const lib = await call("GET", "/api/parent/articles");
  console.log(`\nlibrary: ${JSON.stringify(lib.counts)}${lib.aiPaused ? ` — pipeline paused until ${lib.aiPaused.until} (${lib.aiPaused.reason})` : ""}`);
  console.log("The pipeline processes queued articles every 30 minutes within the daily AI budget.");
}

// run only when executed directly (tests import extract())
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
