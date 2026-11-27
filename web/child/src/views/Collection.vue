<script setup>
import { ref, onMounted } from "vue";
import { api } from "../lib/api.js";
import { app } from "../state.js";
import PageHead from "../components/PageHead.vue";

const c = ref(null);
onMounted(async () => {
  try { c.value = await api("GET", "/api/collection"); } catch { c.value = { cards: [], medals: [], error: true }; }
});
const count = (s) => c.value.cards.filter((x) => x.status === s).length;
</script>

<template>
  <PageHead title="生字图鉴" />
  <p v-if="!c" class="center muted">正在翻图鉴……</p>
  <template v-else>
    <p class="muted center" style="font-size: 15px; margin: 0 0 8px">这里是读故事时遇到的字。首页的“认识的字”还算上了测评和课本里的字。</p>
    <div class="legend"><span>🏅 已驯服 {{ count("mastered") }}</span><span>💙 认识 {{ count("familiar") }}</span><span>👀 见过 {{ count("seen") }}</span></div>
    <div v-if="c.medals.length" class="card"><b>我的勋章 </b><span v-for="m in c.medals" :key="m.title" class="medal">🏅 {{ m.title }}</span></div>
    <div v-if="c.cards.length" class="cards">
      <div v-for="x in c.cards" :key="x.char" class="ccard tile" :class="x.status" @click="app.card = x.char">
        <div class="big">{{ x.char }}</div>
        <div class="py">{{ x.pinyin || "" }}</div>
        <div class="tag">{{ x.from ? `来自《${x.from}》` : "" }}</div>
      </div>
    </div>
    <div v-else class="card center"><p>{{ c.error ? "需要联网才能看图鉴。" : "图鉴还是空的。读完第一篇故事，生字卡就会出现在这里！" }}</p></div>
  </template>
</template>
