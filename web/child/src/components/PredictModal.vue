<!-- 预测: stop before the turn of the story; one guess, no right or wrong. -->
<script setup>
import { reading } from "../reading.js";
import { questApi, toast } from "../lib/api.js";
import Modal from "./Modal.vue";

const emit = defineEmits(["close"]);
const R = reading.R;
const p = R.predict;
async function guess(i) {
  const r = await questApi("POST", `/api/session/${R.session.id}/answer`, { questionId: p.id, choice: i });
  if (!r) return;
  R.answered.set(p.id, { attempts: 1, correct: i === r.answer, choice: i });
  R.predictResult = r;
  toast("记住你的猜测，往下读揭晓！", 2600);
  emit("close");
}
</script>

<template>
  <Modal>
    <div class="task"><div class="lbl">技能 · 预测</div>{{ p.prompt }}</div>
    <p class="muted">先别往下读！根据前面的内容猜一猜。猜什么都可以，读下去就知道了。</p>
    <div class="opts"><Btn v-for="(o, i) in p.options" :key="i" :action="() => guess(i)">{{ o }}</Btn></div>
    <div class="row center" style="margin-top: 12px"><button class="ghost small" @click="emit('close')">先不猜，接着读</button></div>
  </Modal>
</template>
