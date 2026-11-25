<script setup>
import { computed } from "vue";
const props = defineProps({ items: { type: Array, required: true } });
const cx = 150, cy = 140, R = 100;
const pt = (i, r) => {
  const n = props.items.length;
  return [cx + r * Math.sin((2 * Math.PI * i) / n), cy - r * Math.cos((2 * Math.PI * i) / n)];
};
const ring = (f) => props.items.map((_, i) => pt(i, R * f).join(",")).join(" ");
const shape = computed(() => props.items.map((it, i) => pt(i, (R * (it.rate ?? 0)) / 100).join(",")).join(" "));
</script>

<template>
  <svg viewBox="0 0 300 280" width="100%" style="max-width: 340px">
    <polygon v-for="f in [0.25, 0.5, 0.75, 1]" :key="f" :points="ring(f)" fill="none" stroke="var(--line)" />
    <g v-for="(it, i) in items" :key="it.name">
      <line :x1="cx" :y1="cy" :x2="pt(i, R)[0]" :y2="pt(i, R)[1]" stroke="var(--line)" />
      <text :x="pt(i, R + 22)[0]" :y="pt(i, R + 22)[1]" text-anchor="middle" dominant-baseline="middle">{{ it.name }} {{ it.rate == null ? "—" : it.rate + "%" }}</text>
    </g>
    <polygon :points="shape" fill="rgba(123,92,200,.22)" stroke="var(--accent)" stroke-width="2" />
  </svg>
</template>
