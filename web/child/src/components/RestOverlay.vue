<!-- Eye-care rest page: locks the screen for the rest minutes (§15). -->
<script setup>
import { ref, watch, onUnmounted } from "vue";
import { clock, endRest } from "../lib/clock.js";

const TIPS = ["看看窗外最远的地方，找一找有几种颜色。", "眨眨眼睛，转一转眼珠：上、下、左、右。", "站起来伸个懒腰，学小猎犬抖一抖。"];
const left = ref(0);
const tip = ref(TIPS[0]);
let timer = null;
watch(() => clock.resting, (on) => {
  clearInterval(timer);
  if (!on) return;
  tip.value = TIPS[Math.floor(Math.random() * TIPS.length)];
  left.value = Math.max(0, clock.restMin * 60);
  timer = setInterval(() => { if (left.value > 0) left.value--; else clearInterval(timer); }, 1000);
}, { immediate: true });
onUnmounted(() => clearInterval(timer));
const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
</script>

<template>
  <Teleport to="body">
    <div v-if="clock.resting" class="rest">
      <div style="font-size: 64px">🌳</div>
      <h2>小猎犬说：眼睛要休息啦</h2>
      <p>{{ tip }}</p>
      <p style="opacity: 0.8; font-size: 17px">读书时记得：眼离书本一尺，胸离桌子一拳，手离笔尖一寸。</p>
      <div class="count">{{ left > 0 ? fmt(left) : "✓" }}</div>
      <button v-if="left <= 0" class="big" @click="endRest">休息好了，继续</button>
    </div>
  </Teleport>
</template>
