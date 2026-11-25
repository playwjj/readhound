<!-- 1. 生字预热: one card per new character, heard aloud. -->
<script setup>
import { ref, watchEffect } from "vue";
import { reading } from "../reading.js";
import { speak } from "../lib/voice.js";
import PageHead from "../components/PageHead.vue";

const emit = defineEmits(["done"]);
const R = reading.R;
const cards = R.newChars;
const i = ref(0);
watchEffect(() => speak(cards[i.value].char));
const next = () => (i.value < cards.length - 1 ? i.value++ : emit("done"));
</script>

<template>
  <PageHead :title="R.article.title" :pct="0" />
  <p class="center muted">读之前，先认识 {{ cards.length }} 个新朋友</p>
  <div class="card warm-card">
    <div class="big">{{ cards[i].char }}</div>
    <div class="py">{{ cards[i].pinyin }}</div>
    <div v-if="cards[i].word && cards[i].word !== cards[i].char" class="word">{{ cards[i].word }}</div>
    <div v-if="cards[i].gloss" class="gloss">{{ cards[i].gloss }}</div>
    <div v-if="cards[i].example" class="gloss">例：{{ cards[i].example }}</div>
    <div class="row center" style="margin-top: 14px">
      <button class="soft" @click="speak(cards[i].word || cards[i].char)">🔊 听一听</button>
    </div>
  </div>
  <div class="dots"><i v-for="(_, k) in cards" :key="k" :class="{ on: k === i }" /></div>
  <div class="row center">
    <button v-if="i > 0" class="ghost" @click="i--">上一个</button>
    <button @click="next">{{ i < cards.length - 1 ? "下一个" : "玩个小游戏" }}</button>
  </div>
</template>
