<!-- 30-second warm-up game: hear a character, tap it (§6 读前预热). -->
<script setup>
import { ref, computed, onMounted } from "vue";
import { reading, progressAt } from "../reading.js";
import { speak } from "../lib/voice.js";
import { shuffle } from "../lib/fx.js";
import PageHead from "../components/PageHead.vue";

const emit = defineEmits(["done"]);
const R = reading.R;
const cards = R.newChars;
const order = shuffle(cards).slice(0, Math.min(3, cards.length));
const r = ref(0);
const target = computed(() => order[r.value]);
const opts = ref([]);
const marks = ref({});
const fb = ref(null);

function setup() {
  opts.value = shuffle([target.value, ...shuffle(cards.filter((c) => c !== target.value)).slice(0, 2)]);
  marks.value = {};
  fb.value = null;
  setTimeout(say, 300);
}
const say = () => speak(target.value.word || target.value.char);
function pick(o) {
  if (o === target.value) {
    marks.value = { ...marks.value, [o.char]: "right" };
    fb.value = { ok: true, text: `对啦！“${o.char}”读 ${o.pinyin}` };
    setTimeout(() => {
      if (r.value < order.length - 1) { r.value++; setup(); } else emit("done");
    }, 900);
  } else {
    marks.value = { ...marks.value, [o.char]: "nope" };
    fb.value = { ok: false, text: `这是“${o.char}”（${o.pinyin}），再听听看` };
  }
}
onMounted(setup);
</script>

<template>
  <PageHead :title="R.article.title" :pct="progressAt('warmup', 0.5)" />
  <div class="card center">
    <div class="muted">听音找字 {{ r + 1 }}/{{ order.length }}</div>
    <button class="big soft" style="margin: 14px 0" @click="say">🔊 再听一遍</button>
    <div class="opts py">
      <button v-for="o in opts" :key="o.char" :class="marks[o.char]" style="font-size: 48px; font-family: 'Kaiti SC', 'STKaiti', serif" @click="pick(o)">{{ o.char }}</button>
    </div>
    <div v-if="fb" class="feedback" :class="fb.ok ? 'ok' : 'try'">{{ fb.text }}</div>
  </div>
</template>
