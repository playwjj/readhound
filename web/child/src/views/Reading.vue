<!--
  The reading flow. Each step is a screen (a stage component) that reports
  `done` when the child finishes it; the flow below then decides the next one:

    错题回炉 → 生字预热 → 听音找字 → 读前任务 → 分段阅读 → 闯关题 → 回文定位 → 文章地图
    → 生字小测 → 结算 (→ 复述 / 回看再答 / 慢慢再读 / 再见一面)

  Leaving the page (home button, back gesture) saves progress and stops audio.
-->
<script setup>
import { shallowRef, onMounted, onBeforeUnmount } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, toast } from "../lib/api.js";
import { stopAudio } from "../lib/voice.js";
import { restPoint } from "../lib/clock.js";
import { app } from "../state.js";
import { reading, prepare, begin, leave, flush, settled, progressAt } from "../reading.js";
import Review from "../stages/Review.vue";
import Warmup from "../stages/Warmup.vue";
import MatchGame from "../stages/MatchGame.vue";
import Purpose from "../stages/Purpose.vue";
import ReadStage from "../stages/ReadStage.vue";
import ListenOnly from "../stages/ListenOnly.vue";
import Question from "../stages/Question.vue";
import Locate from "../stages/Locate.vue";
import ArticleMap from "../stages/ArticleMap.vue";
import CharQuiz from "../stages/CharQuiz.vue";
import ReMeet from "../stages/ReMeet.vue";
import Result from "../stages/Result.vue";
import Retell from "../stages/Retell.vue";
import OfflineCard from "../stages/OfflineCard.vue";

const route = useRoute();
const router = useRouter();
const screen = shallowRef(null);
let seq = 0;
let alive = true;

/** Show a screen; resolves with what it reports when done. */
function present(comp, props = {}, { wide = false } = {}) {
  return new Promise((resolve) => {
    if (!alive) return;
    restPoint(); // the last step is over: a rest that came due during it starts here
    app.wide = wide;
    screen.value = { comp, props, done: resolve, key: ++seq };
    window.scrollTo(0, 0);
  });
}

onMounted(async () => {
  // a reload on this page (or a link) has no session yet: load it
  if (!reading.R && !(await prepare(route.query.extra === "1"))) return router.replace("/");
  if (!alive) return;
  begin();
  start();
});
onBeforeUnmount(() => {
  alive = false;
  leave();
});

const R = () => reading.R;

function start() {
  const r = R();
  if (r.session.level >= 2) {
    // from the home card's 讲给小猎犬听
    if (route.query.retell === "1" && r.retell?.triesLeft > 0) return retellNow();
    return result(null, true);
  }
  if (r.eye.listenOnly) return present(ListenOnly);
  const allQ = [...r.questions, ...(r.guess ? [r.guess] : []), ...r.locates, ...r.sections];
  if (allQ.length && allQ.every((q) => settled(r, q.id))) return charQuiz();
  if (r.session.lastParagraph > 0 || r.answered.size) return read();
  warmup();
}

async function warmup() {
  R().stage = "warmup";
  const rv = R().review || [];
  for (let n = 0; n < rv.length; n++) await present(Review, { q: rv[n], n, total: rv.length });
  if (R().newChars.length) {
    await present(Warmup);
    if (R().newChars.length >= 2) await present(MatchGame);
  }
  if (R().purpose) await present(Purpose);
  read();
}

async function read() {
  R().stage = "read";
  await present(ReadStage);
  stopAudio();
  flush();
  quest();
}

/** only: question ids for a retry round (after looking back). */
async function quest(only) {
  const r = R();
  r.stage = "quest";
  const pending = (q) => (only ? only.includes(q.id) : !settled(r, q.id));
  const qs = r.questions.filter(pending);
  // the pre-reading task's question comes first
  if (r.purpose?.questionId) qs.sort((a, b) => (b.id === r.purpose.questionId) - (a.id === r.purpose.questionId));
  for (let n = 0; n < qs.length; n++) await present(Question, { q: qs[n], n, total: qs.length, retry: !!only });
  if (r.guess && only && only.includes(r.guess.id)) {
    await present(Question, { q: { ...r.guess, abilityName: "猜词义", evidence: r.guess.paragraph }, n: 0, total: 1, retry: true });
  }
  const locs = r.locates.filter(pending);
  for (let n = 0; n < locs.length; n++) await present(Locate, { q: locs[n], n, total: locs.length, retry: !!only });
  const secs = r.sections.filter(pending);
  if (secs.length) await articleMap(secs, !!only);
  charQuiz();
}

/** 概括段意: one summary per section, then the assembled article map. */
async function articleMap(secs, retry) {
  const found = {};
  for (let n = 0; n < secs.length; n++) {
    const q = secs[n];
    const idx = await present(Question, { q: { ...q, abilityName: "概括段意 · 拼文章地图", evidence: q.from }, n, total: secs.length, retry, pct: progressAt("quest", 0.8) });
    if (idx != null) found[q.id] = q.options[idx];
  }
  await present(ArticleMap, { found });
}

async function charQuiz(retryChars) {
  const r = R();
  r.stage = "chars";
  const items = r.charQuiz.filter((c) => (retryChars ? retryChars.includes(c.char) : !r.quiz.has(c.char)));
  for (let n = 0; n < items.length; n++) await present(CharQuiz, { it: items[n], n, total: items.length, retry: !!retryChars });
  finish();
}

async function finish() {
  await flush();
  let res;
  try {
    res = await api("POST", `/api/session/${R().session.id}/finish`);
  } catch (e) {
    if (e.offline) {
      await present(OfflineCard, { msg: "快通关了！需要联网才能结算，连上网再点一次。" });
      return finish();
    }
    if (e.message !== "login") toast(e.message);
    return;
  }
  // the home behind shows the new state at once (it refreshes as well)
  if (res.verdict?.completed && R().session.daily && app.home) Object.assign(app.home, { todayDone: true, canExtra: true });
  result(res, false);
}

async function retellNow() {
  R().stage = "result";
  await present(Retell);
  router.push("/");
}

async function result(res, already) {
  R().stage = "result";
  stopAudio();
  const next = await present(Result, { res, already }, { wide: !!res?.verdict?.completed && !res.alreadyCompleted });
  if (next.action === "retell") {
    await present(Retell);
    return router.push("/");
  }
  if (next.action === "retry") return quest(next.ids);
  if (next.action === "reread") {
    R().idx = 0;
    return read();
  }
  if (next.action === "remeet") {
    for (const ch of next.chars) await present(ReMeet, { ch });
    return charQuiz(next.chars);
  }
  router.push("/");
}
</script>

<template>
  <p v-if="!screen" class="center muted" style="margin-top: 20vh">小猎犬正在翻书……</p>
  <div v-else :key="screen.key" class="page"><component :is="screen.comp" v-bind="screen.props" @done="screen.done" /></div>
</template>
