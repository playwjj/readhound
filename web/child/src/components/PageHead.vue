<!-- Reading header: home button, title, progress bar. -->
<script setup>
import { useRouter } from "vue-router";
defineProps({ title: String, pct: { type: Number, default: null }, back: { type: String, default: "← 回家" }, to: { type: String, default: "/" } });
const router = useRouter();
</script>

<template>
  <div class="reader-head">
    <button class="ghost small" @click="router.push(to)">{{ back }}</button>
    <div class="t">{{ title }}</div>
  </div>
  <div v-if="pct != null" class="progress"><i :style="`width:${Math.round(pct * 100)}%`" /></div>
</template>
