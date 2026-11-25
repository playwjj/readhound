<!--
  Shell: top bar, tabs, login. Pages load their data in an async setup; the
  <Suspense> keeps the previous page on screen (dimmed) until the next one
  has its data, so the tab lights up at once and nothing jumps.
-->
<script setup>
import { ref, onErrorCaptured, onMounted, watch } from "vue";
import { useRoute } from "vue-router";
import { api, auth } from "./api.js";
import { TABS } from "./router.js";
import Login from "./components/Login.vue";

const route = useRoute();
const loading = ref(false);
const error = ref("");

onMounted(async () => {
  try {
    const me = await (await fetch("/api/me", { credentials: "same-origin", headers: { "x-rh-area": "parent" } })).json();
    auth.ok = me.role === "parent";
  } catch {
    auth.ok = false;
  }
});
watch(() => route.fullPath, () => (error.value = ""));
onErrorCaptured((e) => {
  loading.value = false;
  if (e.message !== "login") error.value = e.message || String(e);
  return false;
});
async function logout() {
  await api("POST", "/api/logout", { role: "parent" }).catch(() => {});
  auth.ok = false;
}
</script>

<template>
  <p v-if="auth.ok === null" class="muted">加载中……</p>
  <Login v-else-if="!auth.ok" />
  <template v-else>
    <div class="topbar">
      <h1>字游记 · 家长</h1>
      <div class="spacer" />
      <a class="btn ghost" href="/" style="font-size: 15px; min-height: 40px">孩子端</a>
      <Btn class="ghost small" :action="logout">退出</Btn>
    </div>
    <nav class="tabs">
      <RouterLink v-for="t in TABS" :key="t.path" :to="t.path" active-class="" :class="{ on: route.path.startsWith(t.path) }">{{ t.label }}</RouterLink>
    </nav>
    <div v-if="error" class="card">出错：{{ error }}</div>
    <RouterView v-else v-slot="{ Component }">
      <div class="tab-body" :class="{ stale: loading }">
        <!-- the page itself must be Suspense's direct child for the old one to stay while the new loads -->
        <Suspense @pending="loading = true" @resolve="loading = false">
          <component :is="Component" :key="route.fullPath" />
          <template #fallback><p class="muted">加载中……</p></template>
        </Suspense>
      </div>
    </RouterView>
  </template>
</template>

<style>
/* parent console: denser than the child app */
.shell.parent { max-width: 980px; }
body:has(.shell.parent) { font-size: 16px; }
.tabs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 16px; }
.tabs a { font-size: 15px; min-height: 40px; padding: 6px 14px; border-radius: 999px; background: var(--card); color: var(--ink); box-shadow: var(--shadow); text-decoration: none; display: inline-flex; align-items: center; }
.tabs a.on { background: var(--accent); color: #fff; }
.tabs a:active { transform: scale(0.96); }
.parent table { width: 100%; border-collapse: collapse; font-size: 15px; }
.parent th, .parent td { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--line); vertical-align: top; }
.parent th { color: var(--ink-soft); font-weight: 600; }
.parent input, .parent textarea, .parent select { font: inherit; font-size: 16px; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--line); background: var(--card); color: var(--ink); width: 100%; }
.parent textarea { min-height: 220px; line-height: 1.7; }
.parent label { display: block; margin: 10px 0 4px; font-weight: 600; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 720px) { .grid2 { grid-template-columns: 1fr; } }
.pill { display: inline-block; border-radius: 999px; padding: 1px 10px; font-size: 13px; background: var(--line); }
.pill.ready { background: var(--good-soft); color: var(--good); }
.pill.flagged, .pill.rejected { background: var(--accent-soft); }
.pill.processing, .pill.queued { background: var(--blue-soft); color: var(--blue); }
.kpi { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
@media (max-width: 720px) { .kpi { grid-template-columns: repeat(2, 1fr); } }
.kpi .stat b { font-size: 26px; }
.chars-inline { font-size: 22px; letter-spacing: 4px; line-height: 1.8; word-break: break-all; }
details summary { cursor: pointer; }
.parent svg text { fill: var(--ink-soft); font-size: 12px; }
.small-note { font-size: 13px; }
.py-view { font-size: 20px; line-height: 2.4; }
.py-view ruby { cursor: pointer; margin: 0 1px; display: inline-flex; flex-direction: column-reverse; align-items: center; min-width: 1em; vertical-align: bottom; line-height: 1.25; }
.py-view rt { display: block; font-size: 11px; color: var(--ink-soft); white-space: nowrap; }
.clickable tr[data-href] { cursor: pointer; }
.clickable tr[data-href]:hover td { background: var(--accent-soft); }
.passport { background: #fff; color: #222; padding: 30px; border-radius: 16px; }
.passport h1 { text-align: center; letter-spacing: 6px; }
.stamps { display: grid; grid-template-columns: repeat(7, 1fr); gap: 8px; margin: 16px 0; }
.stamp { aspect-ratio: 1; border: 2px dashed #ccc; border-radius: 50%; display: grid; place-items: center; font-size: 13px; color: #999; }
.stamp.on { border: 3px solid #c0392b; color: #c0392b; font-weight: 700; transform: rotate(-12deg); }
@media print {
  body * { visibility: hidden; }
  .passport, .passport * { visibility: visible; }
  .passport { position: absolute; left: 0; top: 0; width: 100%; box-shadow: none; }
}
</style>
