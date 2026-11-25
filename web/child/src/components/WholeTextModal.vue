<script setup>
import { reading } from "../reading.js";
import Modal from "./Modal.vue";
import ParaText from "./ParaText.vue";
defineEmits(["close"]);
const R = reading.R;
</script>

<template>
  <Modal dismissable @close="$emit('close')">
    <div class="row"><h3 style="margin: 0">{{ R.article.title }}</h3><span class="spacer" /><button class="small" @click="$emit('close')">关闭</button></div>
    <ParaText v-for="(p, i) in R.article.paragraphs" :key="i" :p="p" :i="i" state="done" :pinyin="R.settings.pinyin" :new-set="R.newSet" :review-set="R.reviewSet" />
  </Modal>
</template>
