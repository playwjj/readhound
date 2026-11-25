<!--
  One paragraph with per-character pinyin. New characters are marked yellow,
  review ones softer; any character can be tapped (popover: sound, meaning).
  `missed` marks characters not heard in a read-aloud.
-->
<script setup>
import { computed } from "vue";
import { isHan } from "../lib/fx.js";
import { app } from "../state.js";
import { reading } from "../reading.js";

const props = defineProps({
  p: { type: Object, required: true }, // { text, py }
  i: { type: Number, required: true },
  state: { type: String, default: "current" }, // current | done
  pinyin: { type: String, default: "all" }, // all | new | off
  newSet: { type: Object, default: () => new Set() },
  reviewSet: { type: Object, default: () => new Set() },
  missed: { type: Object, default: null }, // Set of Han-character indices
});

const tokens = computed(() => {
  const syl = props.p.py ? props.p.py.split(" ") : [];
  let k = 0;
  return [...props.p.text].map((ch) => {
    if (!isHan(ch)) return { ch };
    const n = k++;
    const py = syl[n] || "";
    const isNew = props.newSet.has(ch), isRev = props.reviewSet.has(ch);
    return { ch, py, n, isNew, isRev, ruby: props.pinyin === "all" || (props.pinyin === "new" && (isNew || isRev)) };
  });
});

function tap(t) {
  const R = reading.R;
  if (R) {
    R.taps.push(t.ch);
    R.tapped.add(t.ch);
  }
  app.pop = { ch: t.ch, py: t.py };
}
const cls = (t) => ["hz", { new: t.isNew, review: !t.isNew && t.isRev, tapped: reading.R?.tapped.has(t.ch), miss: props.missed?.has(t.n) }];
</script>

<template>
  <div class="para" :class="[state, { 'with-py': pinyin !== 'off' }]" :data-i="i">
    <span class="no">第 {{ i + 1 }} 段</span>
    <template v-for="(t, j) in tokens" :key="j">
      <template v-if="t.n === undefined">{{ t.ch }}</template>
      <ruby v-else-if="t.ruby" :class="cls(t)" @click="tap(t)">{{ t.ch }}<rt>{{ t.py }}</rt></ruby>
      <span v-else :class="cls(t)" @click="tap(t)">{{ t.ch }}</span>
    </template>
  </div>
</template>
