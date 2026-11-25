<!-- 5. 读后生字小测: pick the reading of a character met today. -->
<script setup>
import { ref, computed } from "vue";
import { reading } from "../reading.js";
import { questApi } from "../lib/api.js";
import { speak } from "../lib/voice.js";
import PageHead from "../components/PageHead.vue";

const props = defineProps({ it: Object, n: Number, total: Number, retry: Boolean });
const emit = defineEmits(["done"]);
const R = reading.R;
const res = ref(null);
const chose = ref(null);
const word = computed(() => props.it.word && props.it.word !== props.it.char ? props.it.word : null);
const parts = computed(() => (word.value ? word.value.split(props.it.char) : []));

async function pick(o) {
  const r = await questApi("POST", `/api/session/${R.session.id}/charquiz`, { char: props.it.char, choice: o, retry: props.retry });
  if (!r) return;
  R.quiz.set(props.it.char, { char: props.it.char, correct: r.correct });
  chose.value = o;
  res.value = r;
  speak(props.it.char);
}
const cls = (o) => (res.value && o === res.value.pinyin ? "right" : res.value && o === chose.value ? "nope" : "");
</script>

<template>
  <PageHead :title="R.article.title" :pct="0.88 + 0.1 * (n / total)" />
  <div class="card warm-card">
    <div class="muted">{{ retry ? "再见一面" : it.review ? "老朋友复习" : "生字小测" }} {{ n + 1 }}/{{ total }}</div>
    <div class="big">{{ it.char }}</div>
    <div v-if="word" class="word">
      <template v-for="(s, k) in parts" :key="k"><b v-if="k" style="color: var(--accent)">{{ it.char }}</b>{{ s }}</template>
    </div>
    <div class="opts py" style="margin-top: 16px">
      <Btn v-for="o in it.options" :key="o" :class="cls(o)" :disabled="!!res" :action="() => pick(o)">{{ o }}</Btn>
    </div>
    <div v-if="res" class="feedback" :class="res.correct ? 'ok' : 'try'">
      {{ res.correct ? (res.status === "mastered" ? `“${it.char}”被你彻底驯服了！🏅` : `对啦！“${it.char}”读 ${res.pinyin}`) : `“${it.char}”读 ${res.pinyin}，它还没被驯服，过两天再见面。` }}
    </div>
    <div class="row center" style="margin-top: 12px">
      <button v-if="res" @click="emit('done')">{{ n < total - 1 ? "下一个" : "看看成绩" }}</button>
    </div>
  </div>
</template>
