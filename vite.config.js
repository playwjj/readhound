// Parent console (Vue). Built into public/parent/ and served by Workers
// static assets at /parent/. `wrangler dev` / `wrangler deploy` run the build
// first ([build] in wrangler.toml); `npm run dev:parent` gives hot reload,
// proxying /api to a running `wrangler dev`.
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL("./web/parent", import.meta.url)),
  base: "/parent/",
  plugins: [vue()],
  resolve: { alias: { "@shared": fileURLToPath(new URL("./public", import.meta.url)) } },
  build: {
    outDir: fileURLToPath(new URL("./public/parent", import.meta.url)),
    emptyOutDir: true,
  },
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:8787" } },
});
