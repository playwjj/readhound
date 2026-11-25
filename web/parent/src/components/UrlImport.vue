<!-- 粘贴网址导入: a story page the parent found, for this family's reading only. -->
<script setup>
import { reactive } from "vue";
import { api, toast, attempt } from "../api.js";
import { GENRES } from "../labels.js";

const f = reactive({ url: "", genre: "" });
async function go() {
  await attempt(async () => {
    const r = await api("POST", "/api/parent/import/url", { url: f.url, genre: f.genre });
    const added = r.parts.filter((p) => p.id).length;
    const dup = r.parts.filter((p) => p.duplicate).length;
    toast(`《${r.title}》${r.chars} 字：${r.parts.length > 1 ? `切成 ${r.parts.length} 篇，` : ""}加入 ${added} 篇${dup ? `，${dup} 篇已存在` : ""}`, 4000);
    if (added) f.url = "";
  });
}
</script>

<template>
  <div class="card">
    <h2>粘贴网址导入</h2>
    <p class="muted">在 iPad 上看到合适的故事（童话网站、公众号文章都可以），复制网址粘贴到这里。系统会取出正文，太长的切成几篇按顺序读。只供自家阅读，不会外传。打不开的网站，可以把正文复制到下面的“录入一篇”。</p>
    <div class="row">
      <div style="flex: 3; min-width: 220px"><input v-model="f.url" type="url" inputmode="url" placeholder="https://…" @keydown.enter="go" /></div>
      <div style="flex: 1; min-width: 140px">
        <select v-model="f.genre"><option value="">题材（AI 判断）</option><option v-for="(v, k) in GENRES" :key="k" :value="k">{{ v }}</option></select>
      </div>
      <Btn :action="go">导入</Btn>
    </div>
  </div>
</template>
