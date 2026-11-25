<script setup>
import { computed } from "vue";
import { pupSVG } from "@shared/pup.js";
const props = defineProps({ stage: { type: String, default: "pup" }, acc: { type: Array, default: () => [] }, mood: { type: String, default: "happy" }, size: { type: Number, default: 150 } });
const svg = computed(() => pupSVG(props.stage, props.acc, props.mood));
</script>

<template>
  <div class="pup" :style="`width:${size}px;margin:0 auto`" v-html="svg" />
</template>
