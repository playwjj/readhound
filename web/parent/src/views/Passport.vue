<script setup>
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../api.js";

const route = useRoute();
const router = useRouter();
const month = route.query.m || "";
const p = await api("GET", "/api/parent/passport" + (month ? `?month=${month}` : ""));
const [y, mo] = p.month.split("-").map(Number);
const daysIn = new Date(y, mo, 0).getDate();
const readDays = computed(() => new Set(p.sessions.map((s) => Number(s.date.slice(8)))));
const pickMonth = (e) => router.replace({ path: "/passport", query: { m: e.target.value } });
</script>

<template>
  <div class="row" style="margin-bottom: 12px">
    <input type="month" :value="p.month" style="width: auto" @change="pickMonth" />
    <span class="spacer" />
    <button @click="print()">打印</button>
  </div>
  <div class="passport">
    <h1>阅读护照</h1>
    <p style="text-align: center">{{ p.childName }} · {{ y }} 年 {{ mo }} 月</p>
    <p style="text-align: center; font-size: 18px">本月读了 {{ p.days }} 天、{{ p.sessions.length }} 篇、{{ p.chars }} 字；新驯服 {{ p.mastered.length }} 个生字</p>
    <div class="stamps">
      <div v-for="i in daysIn" :key="i" class="stamp" :class="{ on: readDays.has(i) }">{{ readDays.has(i) ? "已读" : i }}</div>
    </div>
    <h3>本月新驯服的字</h3>
    <div class="chars-inline" style="font-size: 30px">{{ p.mastered.map((c) => c.char).join(" ") || "—" }}</div>
    <div v-if="p.medals.length">
      <h3>本月勋章</h3>
      <span v-for="m in p.medals" :key="m.title" class="medal">🏅 {{ m.title }}</span>
    </div>
    <h3>读过的故事</h3>
    <ol><li v-for="s in p.sessions" :key="s.date + s.title">{{ s.date.slice(5) }} 《{{ s.title }}》</li></ol>
  </div>
</template>
