<!-- 2. 带着问题读: the pre-reading task. -->
<script setup>
import { reading } from "../reading.js";
import PageHead from "../components/PageHead.vue";
defineEmits(["done"]);
const R = reading.R;
</script>

<template>
  <PageHead :title="R.article.title" :pct="0.08" />
  <div class="card center" style="padding: 28px 22px">
    <div style="font-size: 56px">🔍</div>
    <h2>接到一个侦察任务！</h2>
    <div class="task" style="text-align: left"><div class="lbl">带着问题读</div>{{ R.purpose.task }}</div>
    <p class="muted">读完以后，小猎犬会考考你这个任务哦。</p>
    <button class="big" @click="$emit('done')">开始读</button>
  </div>
</template>
