// Front end: two pages built by Vite into dist/, served by Workers static assets.
//   /         child app      (web/index.html, web/child/src)
//   /parent/  parent console (web/parent/index.html, web/parent/src)
// web/shared holds what both use (styles, busy/activity layer, the hound);
// web/public is copied as is (service worker, icons, manifest).
// `wrangler dev` / `wrangler deploy` run the build first ([build] in
// wrangler.toml); `npm run dev:web` gives hot reload, proxying /api to a
// running `wrangler dev`.
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here("./web"),
  base: "/",
  publicDir: here("./web/public"),
  plugins: [vue()],
  resolve: { alias: { "@shared": here("./web/shared") } },
  build: {
    outDir: here("./dist"),
    emptyOutDir: true,
    rollupOptions: { input: { child: here("./web/index.html"), parent: here("./web/parent/index.html") } },
  },
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:8787" } },
});
