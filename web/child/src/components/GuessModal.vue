<!-- 猜词义: work out a word from the sentences around it. -->
<script setup>
import { ref } from "vue";
import { reading, noteAnswer } from "../reading.js";
import { questApi } from "../lib/api.js";
import Modal from "./Modal.vue";

const emit = defineEmits(["close"]);
const R = reading.R;
const g = R.guess;
const marks = ref({});
const fb = ref(null);
const locked = ref(false);
async function pick(i) {
  if (locked.value || marks.value[i]) return;
  const r = await questApi("POST", `/api/session/${R.session.id}/answer`, { questionId: g.id, choice: i });
  if (!r) return;
  noteAnswer(R, g.id, r);
  if (r.correct) {
    marks.value = { ...marks.value, [i]: "right" };
    fb.value = { ok: true, text: `猜对了！${r.explain || ""}` };
    locked.value = true;
    setTimeout(() => emit("close"), 1600);
  } else {
    marks.value = { ...marks.value, [i]: "nope" };
    fb.value = { ok: false, text: r.later ? "没关系，这个词先放一放，读完再说。" : "再读读这个词前后的句子，换一个试试。" };
    if (r.later) {
      locked.value = true;
      setTimeout(() => emit("close"), 1600);
    }
  }
}
</script>

<template>
  <Modal>
    <div class="task"><div class="lbl">技能 · 猜词义</div>{{ g.prompt }}</div>
    <p class="muted">先别急着查，联系前后的句子猜一猜。</p>
    <div class="opts">
      <Btn v-for="(o, i) in g.options" :key="i" :class="marks[i]" :disabled="marks[i] === 'nope' || locked" :action="() => pick(i)">{{ o }}</Btn>
    </div>
    <div v-if="fb" class="feedback" :class="fb.ok ? 'ok' : 'try'">{{ fb.text }}</div>
    <div class="row center" style="margin-top: 12px"><button class="ghost small" @click="emit('close')">先不猜，接着读</button></div>
  </Modal>
</template>
