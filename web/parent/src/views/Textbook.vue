<script setup>
import { ref } from "vue";
import { api, toast, attempt } from "../api.js";
import { hanCount } from "../labels.js";
import UnitEditor from "../components/UnitEditor.vue";

const load = () => api("GET", "/api/parent/units");
const d = ref(await load());
const open = ref(new Set());
const key = (u) => `${u.volume}-${u.unit}`;
const isCur = (u) => d.value.current && d.value.current.volume === u.volume && d.value.current.unit === u.unit;
function toggle(u) {
  const s = new Set(open.value);
  s.has(key(u)) ? s.delete(key(u)) : s.add(key(u));
  open.value = s;
}
async function setCurrent(u) {
  await attempt(async () => {
    const r = await api("POST", "/api/parent/units/current", { volume: u.volume, unit: u.unit });
    toast(`已设为当前单元：${r.upcoming} 个字作为目标，${r.review} 个前面学过的字进入复习`, 4000);
    d.value = await load();
  });
}
async function saved(u) {
  toggle(u);
  d.value = await load();
}
</script>

<template>
  <div class="card">
    <h2>课本进度</h2>
    <p class="muted">按孩子的课本逐单元填好（2026 秋季起四年级用新修订版）。设为“当前单元”后：本单元和下一单元的生字成为选文和 AI 故事的目标；前面单元学过、孩子还不认识的字进入复习；选文和出题向本单元的主题与语文要素倾斜。</p>
    <p class="muted" style="font-size: 14px">预填的单元结构来自公开的改版解读，标“待核对”的请对照课本目录和单元导语修改。生字请从书末“识字表”“写字表”拍照，用 iPad 的实况文本复制粘贴。</p>
  </div>
  <div v-for="u in d.units" :key="key(u)" class="card" :style="isCur(u) ? 'outline:3px solid var(--accent)' : ''">
    <div class="row">
      <b>{{ u.volume }} 第{{ u.unit }}单元 · {{ u.theme || "" }}</b>
      <span v-if="isCur(u)" class="pill ready">当前</span>
      <span class="pill" :class="u.verified ? 'ready' : 'flagged'">{{ u.verified ? "已核对" : "待核对" }}</span>
      <span class="spacer" />
      <span class="muted" style="font-size: 14px">识字 {{ hanCount(u.recognise) }} · 写字 {{ hanCount(u.write) }}</span>
      <Btn v-if="!isCur(u)" class="small" :action="() => setCurrent(u)">设为当前</Btn>
      <button class="small ghost" @click="toggle(u)">{{ open.has(key(u)) ? "收起" : "编辑" }}</button>
    </div>
    <div class="muted" style="font-size: 14px; margin-top: 4px">语文要素：{{ u.focus || "—" }}</div>
    <div style="font-size: 14px">课文：{{ u.lessons || "—" }}</div>
    <UnitEditor v-if="open.has(key(u))" :unit="u" :skills="d.skills" :genres="d.genres" @saved="saved(u)" />
  </div>
</template>
