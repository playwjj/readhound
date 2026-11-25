// Send hand-prepared articles (scripts/prepare.mjs, filled in) to a running
// ReadHound and process them at once: they need no Workers AI, so they are
// ready in a minute whatever the AI quota says.
//
//   export READHOUND_URL=https://<your-domain>   PARENT_PIN=<parent pin>
//   node scripts/import-prepared.mjs data/prepared/*.json
//
// Files without questions yet are skipped. Re-running is safe: an article
// already in the library is reported as a duplicate.
import { readFileSync } from "node:fs";

const BASE = (process.env.READHOUND_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const PIN = process.env.PARENT_PIN;
const files = process.argv.slice(2);
if (!PIN || !files.length) {
  console.error("set READHOUND_URL and PARENT_PIN, then: import-prepared.mjs <file.json …>");
  process.exit(1);
}

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
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

await call("POST", "/api/login", { pin: PIN });
const ids = new Set();
for (const f of files.sort()) {
  const a = JSON.parse(readFileSync(f, "utf8"));
  if (!a.prepared?.questions?.questions?.length) {
    console.log(`– ${a.title}: not prepared yet, skipped`);
    continue;
  }
  try {
    const r = await call("POST", "/api/parent/articles/prepared", a);
    console.log(r.duplicate ? `= ${a.title}: already in the library (#${r.duplicate})` : `✓ ${a.title} → #${r.id}`);
    if (r.id) ids.add(r.id);
  } catch (e) {
    console.log(`✗ ${a.title}: ${e.message}`);
  }
}

// process them now, one by one (they need no AI, so the quota does not matter)
for (const id of ids) {
  process.stdout.write(`processing #${id}`);
  for (let i = 0; i < 60; i++) {
    const r = await call("POST", "/api/parent/pipeline/step", { id });
    if (!r.log) break;
    process.stdout.write(".");
  }
  console.log();
}
const lib = await call("GET", "/api/parent/articles");
console.log(`library: ${JSON.stringify(lib.counts)}`);
