// ReadHound（字游记）— Worker entry point.
// Static PWA from ASSETS; JSON API under /api; cron runs the ingest
// pipeline and picks tomorrow's article. Everything behind a family PIN.
import { configured, roleForPin, issue, clear, rolesOf, throttled, noteFail, noteOk } from "./auth.js";
import * as child from "./child.js";
import * as parent from "./parent.js";
import { drain } from "./pipeline.js";
import { cnDate } from "./lib/logic.js";
import { first } from "./db.js";

const { HttpError } = child;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

async function body(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

/** Route table: [method, regex, roles, handler(env, ctx, match, request)] */
const routes = [
  // ---- child (parent may also use these)
  ["GET", /^\/api\/home$/, "child", (env, ctx) => child.home(env, ctx)],
  ["POST", /^\/api\/session\/start$/, "child", async (env, ctx, m, req) => child.startSession(env, ctx, await body(req))],
  ["POST", /^\/api\/session\/(\d+)\/progress$/, "child", async (env, ctx, m, req) => child.progress(env, Number(m[1]), await body(req))],
  ["POST", /^\/api\/session\/(\d+)\/answer$/, "child", async (env, ctx, m, req) => child.answer(env, Number(m[1]), await body(req))],
  ["POST", /^\/api\/session\/(\d+)\/charquiz$/, "child", async (env, ctx, m, req) => child.charQuiz(env, Number(m[1]), await body(req))],
  ["POST", /^\/api\/session\/(\d+)\/finish$/, "child", (env, ctx, m) => child.finish(env, Number(m[1]))],
  ["POST", /^\/api\/session\/(\d+)\/retell$/, "child", (env, ctx, m, req) => child.retell(env, Number(m[1]), req)],
  ["GET", /^\/api\/assessment\/level\/(\d+)$/, "child", (env, ctx, m, req) => child.assessmentLevel(Number(m[1]), Number(new URL(req.url).searchParams.get("seed")) || 1)],
  ["POST", /^\/api\/assessment\/finish$/, "child", async (env, ctx, m, req) => child.finishAssessment(env, await body(req))],
  ["GET", /^\/api\/chars\/(.+)$/, "child", (env, ctx, m) => child.charCard(env, decodeURIComponent(m[1]))],
  ["GET", /^\/api\/collection$/, "child", (env) => child.collection(env)],
  ["GET", /^\/api\/articles\/(\d+)$/, "child", (env, ctx, m) => child.rereadArticle(env, Number(m[1]))],

  // ---- parent only
  ["GET", /^\/api\/parent\/report$/, "parent", (env) => parent.report(env)],
  ["GET", /^\/api\/parent\/articles$/, "parent", (env, ctx, m, req) => parent.listArticles(env, new URL(req.url).searchParams.get("status"))],
  ["POST", /^\/api\/parent\/articles$/, "parent", async (env, ctx, m, req) => parent.addArticle(env, await body(req))],
  ["POST", /^\/api\/parent\/articles\/bulk$/, "parent", async (env, ctx, m, req) => parent.bulkAdd(env, await body(req))],
  ["GET", /^\/api\/parent\/articles\/(\d+)$/, "parent", (env, ctx, m) => parent.articleDetail(env, Number(m[1]))],
  ["POST", /^\/api\/parent\/articles\/(\d+)\/(approve|retire|requeue|force|pick|delete)$/, "parent", (env, ctx, m) => parent.articleAction(env, Number(m[1]), m[2])],
  ["POST", /^\/api\/parent\/import\/wikisource$/, "parent", async (env, ctx, m, req) => parent.importWikisource(env, await body(req))],
  ["POST", /^\/api\/parent\/pipeline\/step$/, "parent", (env) => parent.pipelineStep(env)],
  ["GET", /^\/api\/parent\/ai-usage$/, "parent", (env) => parent.aiUsage(env)],
  ["POST", /^\/api\/parent\/generate$/, "parent", async (env, ctx, m, req) => parent.generate(env, await body(req))],
  ["GET", /^\/api\/parent\/settings$/, "parent", (env) => parent.getParentSettings(env)],
  ["PUT", /^\/api\/parent\/settings$/, "parent", async (env, ctx, m, req) => parent.putSettings(env, await body(req))],
  ["POST", /^\/api\/parent\/pinyin-fix$/, "parent", async (env, ctx, m, req) => parent.addPinyinFix(env, await body(req))],
  ["DELETE", /^\/api\/parent\/pinyin-fix$/, "parent", async (env, ctx, m, req) => parent.removePinyinFix(env, await body(req))],
  ["GET", /^\/api\/parent\/textbook$/, "parent", (env) => parent.textbookList(env)],
  ["POST", /^\/api\/parent\/textbook$/, "parent", async (env, ctx, m, req) => parent.textbook(env, await body(req))],
  ["DELETE", /^\/api\/parent\/textbook$/, "parent", (env) => parent.clearTextbook(env)],
  ["GET", /^\/api\/parent\/chars$/, "parent", (env, ctx, m, req) => parent.charsOverview(env, new URL(req.url).searchParams.get("status"))],
  ["POST", /^\/api\/parent\/chars$/, "parent", async (env, ctx, m, req) => parent.markChars(env, await body(req))],
  ["POST", /^\/api\/parent\/assessment\/request$/, "parent", (env) => parent.requestAssessment(env)],
  ["GET", /^\/api\/parent\/ledger$/, "parent", (env) => parent.ledger(env)],
  ["POST", /^\/api\/parent\/redeem$/, "parent", async (env, ctx, m, req) => parent.redeem(env, await body(req))],
  ["GET", /^\/api\/parent\/passport$/, "parent", (env, ctx, m, req) => parent.passport(env, new URL(req.url).searchParams.get("month"))],
];

async function api(request, env, ctx, url) {
  const path = url.pathname;
  const ip = request.headers.get("cf-connecting-ip") || "local";

  if (path === "/api/health") {
    return json({ ok: true, app: env.APP_NAME || "字游记", configured: configured(env), bindings: { db: !!env.DB, audio: !!env.AUDIO, ai: !!env.AI }, mockAi: env.AI_MOCK === "1" });
  }
  if (path === "/api/login" && request.method === "POST") {
    if (!configured(env)) return json({ error: "未配置 PIN：请设置 CHILD_PIN / PARENT_PIN / SESSION_SECRET" }, 503);
    if (throttled(ip)) return json({ error: "试太多次了，休息 5 分钟再来" }, 429);
    const { pin } = await body(request);
    const role = roleForPin(env, pin);
    if (!role) {
      noteFail(ip);
      return json({ error: "密码不对" }, 401);
    }
    noteOk(ip);
    return json({ role }, 200, { "set-cookie": await issue(env, role, url.protocol === "https:") });
  }
  if (path === "/api/logout" && request.method === "POST") {
    const { role: which } = await body(request);
    return json({ ok: true }, 200, { "set-cookie": clear(which === "child" ? "child" : "parent") });
  }

  const roles = await rolesOf(env, request);
  // the parent console marks its requests; the child app never gets parent rights from a parent cookie
  const area = request.headers.get("x-rh-area") === "parent" ? "parent" : "child";
  const role = area === "parent" ? (roles.parent ? "parent" : null) : roles.child || roles.parent ? "child" : null;
  if (path === "/api/me") return json({ role, roles, configured: configured(env) });
  if (!role) return json({ error: "login required" }, 401);

  // pre-generated read-aloud audio (R2), cacheable on device for offline reading
  const am = path.match(/^\/api\/audio\/(\d+)\/(\d+)$/);
  if (am && request.method === "GET") {
    if (!env.AUDIO) return json({ error: "no audio" }, 404);
    const obj = await env.AUDIO.get(`audio/${am[1]}/${am[2]}.mp3`);
    if (!obj) return json({ error: "no audio" }, 404);
    return new Response(obj.body, { headers: { "content-type": "audio/mpeg", "cache-control": "private, max-age=2592000" } });
  }

  for (const [method, re, need, handler] of routes) {
    if (method !== request.method) continue;
    const m = path.match(re);
    if (!m) continue;
    if (need === "parent" && role !== "parent") return json({ error: "parent only" }, 403);
    try {
      return json(await handler(env, ctx, m, request));
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error("[api]", request.method, path, e && (e.stack || e.message));
      return json({ error: e?.message || "internal error" }, 500);
    }
  }
  return json({ error: "not_found" }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return api(request, env, ctx, url);
    return env.ASSETS.fetch(request);
  },

  /**
   * Cron: drain the ingest queue; in the early-morning run also pick today's
   * article ahead of time so its glosses are generated before the child opens it.
   */
  async scheduled(event, env, ctx) {
    const log = await drain(env, 10 * 60000, 120);
    if (log.length) console.log("[cron] pipeline", log.join(" | "));
    const today = cnDate();
    const have = await first(env, "SELECT 1 FROM daily_pick WHERE date = ?", today);
    if (!have) {
      const pick = await child.ensurePick(env, today, null);
      console.log("[cron] pick", today, pick ? `#${pick.article_id} ${pick.reason}` : "none (library empty)");
    }
    const gen = await child.maybeAutoGenerate(env);
    if (gen) console.log("[cron] library short of suitable articles: queued a story", gen.id, gen.spec.targets.join(""));
  },
};
