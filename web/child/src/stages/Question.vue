<!-- 4. 闯关: one multiple-choice question (also 猜词义 retries and 概括段意). -->
<script setup>
import { ref } from "vue";
import { reading, noteAnswer } from "../reading.js";
import { questApi } from "../lib/api.js";
import { speak } from "../lib/voice.js";
import PageHead from "../components/PageHead.vue";
import LookBackModal from "../components/LookBackModal.vue";
import WholeTextModal from "../components/WholeTextModal.vue";

const props = defineProps({ q: Object, n: Number, total: Number, retry: Boolean, pct: { type: Number, default: null } });
const emit = defineEmits(["done"]);
const R = reading.R;
const isTask = R.purpose?.questionId === props.q.id;
const marks = ref({});
const over = ref(false); // answered (right, or the answer shown)
const fb = ref(null);
const look = ref(null);
const whole = ref(false);
let rightIndex = null; // the article map needs it

async function pick(i) {
  const r = await questApi("POST", `/api/session/${R.session.id}/answer`, { questionId: props.q.id, choice: i });
  if (!r) return;
  noteAnswer(R, props.q.id, r);
  if (r.correct) {
    rightIndex = i;
    marks.value = { ...marks.value, [i]: "right" };
    over.value = true;
    fb.value = { ok: true, bold: "答对了！🐾 ", text: r.explain || "" };
  } else if (r.answer != null || r.done) {
    // last try: show the right answer kindly
    rightIndex = r.answer;
    marks.value = { ...marks.value, [r.answer]: "right" };
    over.value = true;
    fb.value = { ok: false, text: "这道题还没被驯服。正确答案已经标出来了。", more: r.explain };
  } else if (r.later) {
    marks.value = { ...marks.value, [i]: "nope" };
    over.value = true;
    fb.value = { ok: false, text: "这道题有点难，我们先往下走，等会儿再回来看看。" };
  } else {
    marks.value = { ...marks.value, [i]: "nope" };
    fb.value = { ok: false, bold: "这个答案还没被驯服 🐾 ", text: r.hint || "", evidence: r.evidence };
  }
}
const readQuestion = () => speak(props.q.prompt + "。" + props.q.options.map((o, i) => `${"ABCD"[i]}，${o}`).join("。"));
</script>

<template>
  <PageHead :title="R.article.title" :pct="pct ?? 0.6 + 0.25 * (n / Math.max(total, 1))" />
  <div class="card">
    <div class="row">
      <span class="ability">{{ isTask ? "读前任务" : q.abilityName || "闯关" }}</span>
      <span v-if="retry" class="ability">再试一次</span>
      <span class="spacer" /><span class="muted">{{ n + 1 }} / {{ total }}</span>
    </div>
    <div class="q">{{ q.prompt }}</div>
    <div class="opts">
      <Btn v-for="(o, i) in q.options" :key="i" :class="marks[i]" :disabled="over || marks[i] === 'nope'" :action="() => pick(i)">{{ "ABCD"[i] }}. {{ o }}</Btn>
    </div>
    <div v-if="fb" class="feedback" :class="fb.ok ? 'ok' : 'try'">
      <b v-if="fb.bold">{{ fb.bold }}</b>{{ fb.text }}
      <div v-if="fb.more">{{ fb.more }}</div>
      <div v-if="fb.evidence != null" style="margin-top: 8px"><button class="small" @click="look = fb.evidence">去第 {{ fb.evidence + 1 }} 段看看</button></div>
    </div>
    <div class="row" style="margin-top: 14px">
      <button class="ghost small" @click="whole = true">📄 看原文</button>
      <button class="ghost small" @click="readQuestion">🔊 读题</button>
      <span class="spacer" />
      <button v-if="over" class="big" @click="emit('done', rightIndex)">{{ n < total - 1 ? "下一题" : "完成闯关" }}</button>
    </div>
  </div>
  <LookBackModal v-if="look != null" :i="look" @close="look = null" />
  <WholeTextModal v-if="whole" @close="whole = false" />
</template>
