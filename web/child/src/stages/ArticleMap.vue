<!-- 文章地图: the section summaries put together. -->
<script setup>
import { reading } from "../reading.js";
import PageHead from "../components/PageHead.vue";
defineProps({ found: Object });
defineEmits(["done"]);
const R = reading.R;
</script>

<template>
  <PageHead :title="R.article.title" :pct="0.85" />
  <div class="card">
    <h2>🗺 文章地图</h2>
    <p class="muted">整篇文章就是这样一步步讲下来的：</p>
    <div v-for="(q, i) in R.sections" :key="q.id" class="map-row">
      <span class="map-no">{{ i + 1 }}</span>
      <div>
        <div class="muted" style="font-size: 14px">第 {{ q.from + 1 }}{{ q.to > q.from ? `–${q.to + 1}` : "" }} 段</div>
        <div>{{ found[q.id] || (R.answered.get(q.id)?.correct ? "✓ 已拼好" : "（这一块还没拼好）") }}</div>
      </div>
    </div>
    <div class="row end" style="margin-top: 12px"><button @click="$emit('done')">继续</button></div>
  </div>
</template>
