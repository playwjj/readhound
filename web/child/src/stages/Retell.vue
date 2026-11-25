<!-- 7. 语音复述: tell the story in your own words; key points come back. -->
<script setup>
import { ref, onBeforeUnmount } from "vue";
import { reading } from "../reading.js";
import { app } from "../state.js";
import { upload } from "../lib/api.js";
import { recorder, canRecord } from "../lib/recorder.js";
import { confetti } from "../lib/fx.js";
import PageHead from "../components/PageHead.vue";
import Pup from "../components/Pup.vue";

defineEmits(["done"]);
const R = reading.R;
const supported = canRecord();
const status = ref("按下按钮，用自己的话把故事讲一遍：讲了什么事、谁做了什么、最后怎样了。");
const state = ref("idle"); // idle | recording | checking | finished
const told = ref(false);
const timer = ref("0:00");
const r = ref(null);
let tick = null;

const rec = recorder(async (blob) => {
  clearInterval(tick);
  state.value = "checking";
  status.value = "小猎犬正在认真听……";
  try {
    const d = await upload(`/api/session/${R.session.id}/retell`, blob, "需要联网才能听你讲，连上网再试试。");
    if (d.tooShort) {
      status.value = d.message;
      state.value = "idle";
      return;
    }
    R.retell.triesLeft = d.triesLeft;
    if (d.passed) confetti();
    status.value = "";
    r.value = d;
    told.value = true;
    state.value = d.passed || !(d.triesLeft > 0) ? "finished" : "idle";
  } catch (e) {
    status.value = e.message;
    state.value = "idle";
  }
}, (msg) => { status.value = msg; state.value = "idle"; });

async function toggle() {
  if (state.value === "recording") return rec.stop();
  if (!(await rec.start())) return;
  state.value = "recording";
  status.value = "正在听……讲完按“讲完了”。";
  tick = setInterval(() => {
    const sec = Math.floor((Date.now() - rec.startedAt) / 1000);
    timer.value = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  }, 250);
}
onBeforeUnmount(() => { clearInterval(tick); rec.stop(); });
</script>

<template>
  <PageHead :title="R.article.title" :pct="1" />
  <div class="card center" style="padding: 26px 20px">
    <Pup :stage="app.home?.puppy.key" :acc="app.home?.accessories" :size="110" />
    <h2>讲给小猎犬听</h2>
    <p v-if="!supported">这台设备的浏览器不支持录音。</p>
    <p v-else class="muted">{{ status }}</p>
    <div class="count" style="font-size: 40px; font-variant-numeric: tabular-nums">{{ timer }}</div>
    <button v-if="supported && state !== 'finished'" class="big" :disabled="state === 'checking'" @click="toggle">
      {{ state === "recording" ? "⏹ 讲完了" : told ? "🎤 再讲一遍" : "🎤 开始讲" }}
    </button>
    <div v-if="r">
      <div class="feedback" :class="r.passed ? 'ok' : 'try'">
        <b>{{ r.passed ? "讲得真棒！🎉 " : "讲得不错！ " }}</b>{{ r.feedback }}
        <div v-if="r.bones">完成复述 +{{ r.bones }} 🦴</div>
      </div>
      <div class="card" style="margin-top: 12px; box-shadow: none; border: 1px solid var(--line)">
        <b>你讲到了 {{ r.covered.length }} 件重要的事：</b>
        <div v-for="p in r.covered" :key="p">✓ {{ p }}</div>
        <div v-if="r.missed.length" class="muted" style="margin-top: 8px">还可以讲讲：{{ r.missed.join("；") }}</div>
        <div v-if="r.tip" class="muted">💡 {{ r.tip }}</div>
      </div>
      <details style="margin-top: 8px"><summary class="muted">小猎犬听到的话</summary><p>{{ r.transcript }}</p></details>
    </div>
    <div class="row center" style="margin-top: 16px"><button class="ghost" @click="$emit('done')">回家</button></div>
  </div>
</template>
