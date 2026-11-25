// Load the public samples into a running Worker and process them.
//   BASE=http://127.0.0.1:8799 PARENT_PIN=8888 node scripts/seed.mjs
import { readFileSync, readdirSync } from "node:fs";
const BASE = process.env.BASE || "http://127.0.0.1:8799";
let cookie = "";
async function call(method, path, body) {
  const res = await fetch(BASE + path, { method, headers: { "content-type": "application/json", cookie, "x-rh-area": "parent" }, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  const data = await res.json();
  if (!res.ok) throw new Error(`${path}: ${JSON.stringify(data)}`);
  return data;
}
await call("POST", "/api/login", { pin: process.env.PARENT_PIN || "8888" });
const dir = new URL("../samples/", import.meta.url);
for (const f of readdirSync(dir).filter((x) => x.endsWith(".txt"))) {
  // first line is the title when short; otherwise the file name (e.g. untitled reference samples)
  const lines = readFileSync(new URL(f, dir), "utf8").split("\n");
  const titled = [...lines[0].trim()].length <= 20;
  const title = titled ? lines[0].trim() : f.replace(/\.txt$/, "");
  const rest = titled ? lines.slice(1) : lines;
  console.log(title, await call("POST", "/api/parent/articles", { title, body: rest.join("\n"), source: "示例（公开）", kind: "sample" }));
}
for (;;) {
  const r = await call("POST", "/api/parent/pipeline/step");
  if (r.log) console.log(" ", r.log);
  if (!r.pending) break;
}
