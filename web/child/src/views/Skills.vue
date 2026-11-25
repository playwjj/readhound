<script setup>
import { app } from "../state.js";
import PageHead from "../components/PageHead.vue";

const ICONS = { extract: "🔎", purpose: "🎯", guess: "🤔", predict: "🔮", locate: "📍", summarise: "🧩", retell: "🎤", readaloud: "🎙" };
</script>

<template>
  <PageHead title="技能法宝" />
  <div v-if="app.home" class="duo">
    <div v-for="s in app.home.skills" :key="s.key" class="card skill" :class="{ locked: !s.unlocked }">
      <div class="badge">{{ ICONS[s.key] || "⭐" }}</div>
      <div>
        <b>{{ s.name }}</b>
        <div class="muted">{{ s.desc }}</div>
        <div style="font-size: 15px">{{ s.unlocked ? "✅ 已解锁" : `🔒 再通关 ${s.need} 篇解锁` }}</div>
      </div>
    </div>
  </div>
</template>
