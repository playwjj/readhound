// ReadHound（字游记）— Worker entry point (skeleton)
//
// Routes:
//   /api/health    liveness + binding check
//   /api/today     today's article pick (stub)
//   /api/articles/:id   article with preparation payload (stub)
//   /api/progress  reading progress summary (stub)
//   everything else -> static web app (ASSETS)
//
// Bindings (see wrangler.toml): DB (D1), AUDIO (R2), AI (Workers AI),
// ASSETS (static). All AI work happens at ingest time (scheduled);
// the reading path serves pre-generated content only.

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/health") {
      return json({
        ok: true,
        app: env.APP_NAME || "字游记",
        bindings: {
          db: Boolean(env.DB),
          audio: Boolean(env.AUDIO),
          ai: Boolean(env.AI),
        },
      });
    }

    if (path === "/api/today") {
      // TODO(phase-1): read today's pick from D1 (daily_pick table),
      // chosen by the scheduler from screened articles: right difficulty,
      // due-review characters preferred, genre rotation.
      return json({ date: new Date().toISOString().slice(0, 10), article: null });
    }

    const articleMatch = path.match(/^\/api\/articles\/(\d+)$/);
    if (articleMatch) {
      // TODO(phase-1): article body + paragraphs + new-character cards +
      // pre-generated questions + audio URL, all prepared at ingest time.
      return json({ id: Number(articleMatch[1]), article: null }, 404);
    }

    if (path === "/api/progress") {
      // TODO(phase-1): per-article completion, streak, totals
      // (articles / characters / minutes) for child + parent views.
      return json({ streak: 0, articlesDone: 0, charactersMastered: 0 });
    }

    if (path.startsWith("/api/")) {
      return json({ error: "not_found" }, 404);
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    // Ingestion pipeline (phase-1), one article per step, chunked to
    // stay inside Worker CPU limits:
    //   1. pull new materials from configured sources
    //   2. hard metrics in code: known-character coverage, new-character
    //      density, sentence length -> difficulty score (reject if off)
    //   3. Workers AI: age-fit / genre judgement, new-character glosses,
    //      question generation (validated, retried on failure)
    //   4. MeloTTS: pre-generate read-aloud audio -> R2
    //   5. compute tomorrow's pick
    console.log("readhound scheduled run", event.cron);
  },
};
