<!-- One paragraph again (after a wrong answer, or before a retry round). -->
<script setup>
import { reading } from "../reading.js";
import { playParagraph, stopAudio } from "../lib/voice.js";
import Modal from "./Modal.vue";
import ParaText from "./ParaText.vue";

const props = defineProps({ i: Number });
const emit = defineEmits(["close"]);
const R = reading.R;
const p = R.article.paragraphs[props.i];
const close = () => { stopAudio(); emit("close"); };
</script>

<template>
  <Modal>
    <h3>第 {{ i + 1 }} 段</h3>
    <ParaText :p="p" :i="i" :pinyin="R.settings.pinyin" :new-set="R.newSet" :review-set="R.reviewSet" />
    <div class="row center">
      <button class="soft" @click="playParagraph(p)">🔊 读给我听</button>
      <button @click="close">找到了，回去答题</button>
    </div>
  </Modal>
</template>
