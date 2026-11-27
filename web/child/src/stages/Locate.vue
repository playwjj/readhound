<!-- 回文定位: tap the sentence that proves the answer. -->
<script setup>
import { ref, computed } from "vue";
import { reading, noteAnswer, progressAt } from "../reading.js";
import { questApi } from "../lib/api.js";
import { isHan } from "../lib/fx.js";
import PageHead from "../components/PageHead.vue";

const props = defineProps({ q: Object, n: Number, total: Number, retry: Boolean });
const emit = defineEmits(["done"]);
const R = reading.R;
const picked = ref(null);
const marks = ref({});
const fb = ref(null);
const over = ref(false);

// sentences with pinyin; the paragraph's syllables run on across its sentences
const paras = computed(() => props.q.paras.map((p) => {
  const syl = (R.article.paragraphs[p.index].py || "").split(" ");
  let k = 0;
  return {
    index: p.index,
    sentences: p.sentences.map((text, s) => ({
      key: p.index * 100 + s,
      chars: [...text].map((ch) => (isHan(ch) ? { ch, py: syl[k++] || "" } : { ch })),
    })),
  };
}));

function pick(key) {
  if (marks.value[key] === "nope" || over.value) return;
  picked.value = key;
}
async function confirm() {
  const r = await questApi("POST", `/api/session/${R.session.id}/answer`, { questionId: props.q.id, choice: picked.value });
  if (!r) return;
  noteAnswer(R, props.q.id, r);
  const key = picked.value;
  picked.value = null;
  if (r.correct) {
    marks.value = { ...marks.value, [key]: "right" };
    fb.value = { ok: true, bold: "找到了！🐾 ", text: r.explain || "" };
    over.value = true;
  } else {
    marks.value = { ...marks.value, [key]: "nope" };
    if (r.answer != null) {
      marks.value = { ...marks.value, [r.answer]: "right" };
      fb.value = { ok: false, text: "这句话还没被找到，绿色的就是依据句。", more: r.explain };
      over.value = true;
    } else if (r.later) {
      fb.value = { ok: false, text: "这题有点难，先往下走，等会儿再回来找。" };
      over.value = true;
    } else fb.value = { ok: false, text: r.hint || "不是这一句，再找找。" };
  }
}
</script>

<template>
  <PageHead :title="R.article.title" :pct="progressAt('quest', 0.7)" />
  <div class="card">
    <div class="row">
      <span class="ability">回文定位</span><span v-if="retry" class="ability">再试一次</span>
      <span class="spacer" /><span class="muted">{{ n + 1 }} / {{ total }}</span>
    </div>
    <div class="q">{{ q.prompt }}</div>
    <p class="muted" style="margin-top: -8px">在下面的原文里，点出能证明答案的那一句话。</p>
  </div>
  <div v-for="p in paras" :key="p.index" class="para current with-py">
    <span class="no">第 {{ p.index + 1 }} 段</span>
    <span v-for="s in p.sentences" :key="s.key" class="sent" :class="[marks[s.key], { picked: picked === s.key }]" @click="pick(s.key)">
      <template v-for="(c, j) in s.chars" :key="j">
        <ruby v-if="c.py !== undefined && R.settings.pinyin === 'all'" class="hz">{{ c.ch }}<rt>{{ c.py }}</rt></ruby>
        <span v-else-if="c.py !== undefined" class="hz">{{ c.ch }}</span>
        <template v-else>{{ c.ch }}</template>
      </template>
    </span>
  </div>
  <div class="card">
    <div v-if="fb" class="feedback" :class="fb.ok ? 'ok' : 'try'"><b v-if="fb.bold">{{ fb.bold }}</b>{{ fb.text }}<div v-if="fb.more">{{ fb.more }}</div></div>
    <div class="row end" style="margin-top: 10px">
      <Btn v-if="!over" :disabled="picked == null" :action="confirm">就是这句 ✓</Btn>
      <button v-else class="big" @click="emit('done')">继续</button>
    </div>
  </div>
</template>
