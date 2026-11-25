<script setup>
import { computed } from "vue";
const props = defineProps({ rows: { type: Array, required: true } });
const W = 600, H = 200, P = 34;
const scale = computed(() => {
  const rows = props.rows;
  const max = Math.max(...rows.map((r) => r.known), 100);
  const min = Math.min(...rows.map((r) => r.known));
  const lo = Math.max(0, Math.floor((min - 50) / 100) * 100);
  const x = (i) => P + (rows.length === 1 ? (W - 2 * P) / 2 : (i * (W - 2 * P)) / (rows.length - 1));
  const y = (v) => H - P - ((v - lo) / Math.max(1, max - lo)) * (H - 2 * P);
  return { x, y, ticks: [lo, Math.round((lo + max) / 2), max] };
});
const line = computed(() => props.rows.map((r, i) => `${scale.value.x(i)},${scale.value.y(r.known)}`).join(" "));
</script>

<template>
  <p v-if="!rows.length" class="muted">还没有数据。</p>
  <svg v-else :viewBox="`0 0 ${W} ${H}`" width="100%">
    <g v-for="v in scale.ticks" :key="v">
      <line :x1="P" :x2="W - P" :y1="scale.y(v)" :y2="scale.y(v)" stroke="var(--line)" />
      <text x="2" :y="scale.y(v) + 4">{{ v }}</text>
    </g>
    <polyline :points="line" fill="none" stroke="var(--accent)" stroke-width="2.5" />
    <circle v-for="(r, i) in rows" :key="r.date" :cx="scale.x(i)" :cy="scale.y(r.known)" r="3" fill="var(--accent)">
      <title>{{ r.date }}：认识 {{ r.known }}，掌握 {{ r.mastered }}</title>
    </circle>
    <text :x="P" :y="H - 8">{{ rows[0].date }}</text>
    <text v-if="rows.length > 1" :x="W - P" :y="H - 8" text-anchor="end">{{ rows[rows.length - 1].date }}</text>
  </svg>
</template>
