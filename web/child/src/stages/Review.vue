<!--
  0. 错题回炉: a question missed first time on an earlier day, with the
  paragraph that holds its answer. One try; then the answer is shown kindly.
-->
<script setup>
import { ref } from "vue";
import { reading, progressAt } from "../reading.js";
import { questApi } from "../lib/api.js";
import { speak } from "../lib/voice.js";
import PageHead from "../components/PageHead.vue";

const props = defineProps({ q: Object, n: Number, total: Number });
const emit = defineEmits(["done"]);
const R = reading.R;
const marks = ref({});
const fb = ref(null);

async function pick(i) {
  const r = await questApi("POST", `/api/session/${R.session.id}/review`, { questionId: props.q.id, choice: i });
  if (!r) return;
  marks.value = r.correct ? { [i]: "right" } : { [i]: "nope", [r.answer]: "right" };
  fb.value = r.correct
    ? { ok: true, bold: "这回驯服了！🐾 ", text: r.explain || "" }
    : { ok: false, bold: "还差一点 ", text: "正确答案已经标出来了，过两天它还会来找你。", more: r.explain };
}
const readAll = () => speak((props.q.passage ? props.q.passage + "。" : "") + props.q.prompt + "。" + props.q.options.map((o, i) => `${"ABCD"[i]}，${o}`).join("。"));
</script>

<template>
  <PageHead :title="R.article.title" :pct="progressAt('warmup', 0)" />
  <div class="card">
    <div class="row">
      <span class="ability">错题回炉</span>
      <span class="ability">{{ q.abilityName || "闯关" }}</span>
      <span class="spacer" /><span class="muted">{{ n + 1 }} / {{ total }}</span>
    </div>
    <p class="muted" style="margin: 8px 0">上次在《{{ q.title }}》里没答对的一道题，读读这一段，再来试试：</p>
    <div v-if="q.passage" class="passage">{{ q.passage }}</div>
    <div class="q">{{ q.prompt }}</div>
    <div class="opts">
      <Btn v-for="(o, i) in q.options" :key="i" :class="marks[i]" :disabled="!!fb" :action="() => pick(i)">{{ "ABCD"[i] }}. {{ o }}</Btn>
    </div>
    <div v-if="fb" class="feedback" :class="fb.ok ? 'ok' : 'try'">
      <b>{{ fb.bold }}</b>{{ fb.text }}
      <div v-if="fb.more">{{ fb.more }}</div>
    </div>
    <div class="row" style="margin-top: 14px">
      <button class="ghost small" @click="readAll">🔊 读给我听</button>
      <span class="spacer" />
      <button v-if="fb" class="big" @click="emit('done')">{{ n < total - 1 ? "下一题" : "去读今天的故事" }}</button>
    </div>
  </div>
</template>
