<!-- Listen-only (bedtime / daily limit): audio, no lit text (§15). -->
<script setup>
import { ref, onBeforeUnmount } from "vue";
import { reading, flush } from "../reading.js";
import { app } from "../state.js";
import { playParagraph, stopAudio } from "../lib/voice.js";
import PageHead from "../components/PageHead.vue";
import Pup from "../components/Pup.vue";

const R = reading.R;
R.stage = "read";
const paras = R.article.paragraphs;
const playing = ref(false);
const status = ref("");
async function toggle() {
  if (playing.value) { stopAudio(); playing.value = false; return; }
  playing.value = true;
  for (let i = R.idx; i < paras.length && playing.value; i++) {
    R.idx = i;
    status.value = `正在听第 ${i + 1} / ${paras.length} 段`;
    await playParagraph(paras[i]);
  }
  if (playing.value) status.value = "听完啦，明天再来闯关吧。晚安！";
  playing.value = false;
  flush();
}
onBeforeUnmount(() => { playing.value = false; });
</script>

<template>
  <PageHead :title="R.article.title" />
  <div class="card listen-only">
    <Pup :stage="app.home?.puppy.key" :acc="app.home?.accessories" mood="sleepy" :size="130" />
    <h2>{{ R.eye.reason === "bedtime" ? "睡前听故事时间" : "眼睛休息，耳朵听书" }}</h2>
    <p>把平板放下，闭上眼睛听小猎犬讲故事。</p>
    <button class="big-play" @click="toggle">{{ playing ? "⏸" : "▶" }}</button>
    <p class="muted">{{ status }}</p>
  </div>
</template>
