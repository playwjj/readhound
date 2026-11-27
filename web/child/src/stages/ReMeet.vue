<!-- 再见一面: a missed character once more before the retry quiz. -->
<script setup>
import { reading, progressAt } from "../reading.js";
import { speak } from "../lib/voice.js";
import PageHead from "../components/PageHead.vue";
const props = defineProps({ ch: String });
defineEmits(["done"]);
const R = reading.R;
const c = R.glossOf.get(props.ch);
speak(props.ch);
</script>

<template>
  <PageHead :title="R.article.title" :pct="progressAt('chars', 0.5)" />
  <p class="center muted">再看一眼这个新朋友</p>
  <div class="card warm-card">
    <div class="big">{{ ch }}</div>
    <div class="py">{{ c?.pinyin || "" }}</div>
    <div v-if="c?.word && c.word !== ch" class="word">{{ c.word }}</div>
    <div v-if="c?.gloss" class="gloss">{{ c.gloss }}</div>
    <div class="row center" style="margin-top: 12px">
      <button class="soft" @click="speak(c?.word || ch)">🔊</button>
      <button @click="$emit('done')">记住了</button>
    </div>
  </div>
</template>
