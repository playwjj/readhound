<!--
  3. 分段阅读: one paragraph at a time. Modes: 听读 (hear it), 跟读 (hear, then
  read it yourself), 自读. Skills on the way: 预测 before a turn of the story
  (revealed later), 猜词义 at its paragraph, 我来读 (read aloud, scored).
-->
<script setup>
import { ref, computed, nextTick, onMounted } from "vue";
import { reading, flush, settled, progressAt } from "../reading.js";
import { clock, restPoint } from "../lib/clock.js";
import { store } from "../lib/store.js";
import { questApi } from "../lib/api.js";
import { playParagraph, stopAudio } from "../lib/voice.js";
import PageHead from "../components/PageHead.vue";
import ParaText from "../components/ParaText.vue";
import PredictModal from "../components/PredictModal.vue";
import RevealModal from "../components/RevealModal.vue";
import GuessModal from "../components/GuessModal.vue";
import ReadAloudModal from "../components/ReadAloudModal.vue";

const emit = defineEmits(["done"]);
const R = reading.R;
const paras = R.article.paragraphs;
const modal = ref(null); // predict | reveal | guess | readaloud
const reveal = ref(null);
const prog = computed(() => progressAt("read", (R.idx + 1) / paras.length));
const yourTurn = ref(false); // 跟读: the paragraph was heard, now the child reads it

const MODES = [["listen", "🎧 听读"], ["follow", "🗣 跟读"], ["self", "📖 自读"]];
const MODE_NOTE = {
  listen: "听读：小猎犬把每一段读给你听，眼睛跟着字走。",
  follow: "跟读：先听小猎犬读一遍，再轮到你自己大声读。",
  self: "自读：自己读，不认识的字点一下就能听。",
};
function setMode(k) {
  R.mode = k;
  yourTurn.value = false;
  store.set("rh_mode", k);
  if (k !== "self") autoPlay();
  else stopAudio();
}
async function autoPlay() {
  if (R.mode === "self") return;
  const at = R.idx;
  yourTurn.value = false;
  await playParagraph(paras[at]);
  if (reading.R === R && R.stage === "read" && R.idx === at && R.mode === "follow") yourTurn.value = true;
}

const predictHere = computed(() => R.predict && R.idx === R.predict.after && !R.answered.has(R.predict.id));
const guessHere = computed(() => R.guess && R.guess.paragraph === R.idx && !settled(R, R.guess.id));

async function revealPrediction() {
  const p = R.predict, mine = R.answered.get(p?.id);
  if (!p || !mine || R.revealShown) return;
  R.revealShown = true;
  const r = R.predictResult || (await questApi("POST", `/api/session/${R.session.id}/answer`, { questionId: p.id, choice: mine.choice }));
  if (!r) return;
  reveal.value = { mine: mine.choice, r };
  modal.value = "reveal";
}

async function next() {
  stopAudio();
  yourTurn.value = false;
  R.idx++;
  if (R.predict && R.idx === R.predict.reveal) setTimeout(revealPrediction, 600);
  flush();
  await nextTick();
  document.querySelector(".para.current")?.scrollIntoView({ behavior: "smooth", block: "center" });
  restPoint(); // a paragraph is done: a rest that came due waits until here
  if (clock.resting) return;
  autoPlay();
}
function finished() {
  stopAudio();
  emit("done");
}
onMounted(autoPlay);
</script>

<template>
  <PageHead :title="R.article.title" />
  <div class="progress"><i :style="`width:${Math.round(prog * 100)}%`" /></div>
  <div class="mode-pick" style="margin-bottom: 12px">
    <button v-for="[k, label] in MODES" :key="k" class="small" :class="{ on: R.mode === k }" @click="setMode(k)">{{ label }}</button>
  </div>
  <div v-if="R.purpose" class="task" style="margin-bottom: 12px; font-size: 18px"><span class="lbl">任务：</span>{{ R.purpose.task }}</div>

  <ParaText v-for="i in R.idx + 1" :key="i" :p="paras[i - 1]" :i="i - 1" :state="i - 1 === R.idx ? 'current' : 'done'"
    :pinyin="R.settings.pinyin" :new-set="R.newSet" :review-set="R.reviewSet" />

  <p class="mode-note muted">{{ MODE_NOTE[R.mode] }}</p>
  <div class="reader-actions sticky">
    <div v-if="yourTurn" class="your-turn">🗣 轮到你啦：自己大声读一遍这一段，读完点“下一段”</div>
    <button v-if="R.mode !== 'self'" class="soft" @click="yourTurn = false; playParagraph(paras[R.idx])">🔊 {{ R.mode === "follow" ? "再听一遍" : "读这一段" }}</button>
    <button v-if="R.readAloud" class="soft" @click="stopAudio(); modal = 'readaloud'">🎙 我来读</button>
    <button v-if="predictHere" @click="modal = 'predict'">🔮 猜猜后面会怎样</button>
    <button v-else-if="guessHere" @click="modal = 'guess'">🤔 猜一猜词义</button>
    <button v-else-if="R.idx < paras.length - 1" class="big" @click="next">下一段 ↓</button>
    <button v-else class="big" @click="finished">读完啦，去闯关 ⚔️</button>
  </div>
  <p class="center muted" style="font-size: 15px">黄色的是新朋友，点任何一个字都能听它的读音。</p>
  <div class="sticky-spacer" />

  <PredictModal v-if="modal === 'predict'" @close="modal = null" />
  <RevealModal v-if="modal === 'reveal'" v-bind="reveal" @close="modal = null" />
  <GuessModal v-if="modal === 'guess'" @close="modal = null" />
  <ReadAloudModal v-if="modal === 'readaloud'" :i="R.idx" @close="modal = null" />
</template>
