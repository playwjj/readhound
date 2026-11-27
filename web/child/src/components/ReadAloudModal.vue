<!-- 我来读 (朗读流利度): record one paragraph; missed characters are marked. -->
<script setup>
import { ref, onBeforeUnmount } from "vue";
import { reading } from "../reading.js";
import { upload } from "../lib/api.js";
import { speak } from "../lib/voice.js";
import { recorder, canRecord } from "../lib/recorder.js";
import Modal from "./Modal.vue";
import ParaText from "./ParaText.vue";

const props = defineProps({ i: Number });
defineEmits(["close"]);
const R = reading.R;
const p = R.article.paragraphs[props.i];
const supported = canRecord();
const status = ref("按“开始读”，把这一段大声读一遍，读完按“读完了”。");
const state = ref("idle"); // idle | recording | checking
const again = ref(false);
const left = ref(1);
const result = ref(null);
const missed = ref(null);

const rec = recorder(async (blob, ms) => {
  state.value = "checking";
  status.value = "小猎犬正在认真听……";
  try {
    const d = await upload(`/api/session/${R.session.id}/fluency?para=${props.i}&ms=${ms}`, blob, "需要联网才能听你读，连上网再试试。");
    if (d.tooShort) {
      status.value = d.message;
    } else {
      status.value = "";
      result.value = d;
      missed.value = new Set(d.missed.map((m) => m.index));
      left.value = d.left;
      again.value = true;
    }
  } catch (e) {
    status.value = e.message;
  }
  state.value = "idle";
}, (msg) => { status.value = msg; state.value = "idle"; });

async function toggle() {
  if (state.value === "recording") return rec.stop();
  result.value = null;
  missed.value = null;
  if (await rec.start()) {
    state.value = "recording";
    status.value = "正在听……";
  }
}
onBeforeUnmount(() => rec.stop());
const pct = () => Math.round(result.value.accuracy * 100);
</script>

<template>
  <Modal>
    <div class="task"><div class="lbl">技能 · 大声朗读</div>第 {{ i + 1 }} 段</div>
    <ParaText :p="p" :i="i" :pinyin="R.settings.pinyin" :new-set="R.newSet" :review-set="R.reviewSet" :missed="missed" />
    <p v-if="!supported">这台设备的浏览器不支持录音。</p>
    <p v-else class="muted">{{ status }}</p>
    <div v-if="result">
      <div class="feedback" :class="pct() >= 80 || !R.readAloudScored ? 'ok' : 'try'">
        <template v-if="R.readAloudScored">
          <b>{{ pct() >= 95 ? "读得又准又顺！🎉 " : pct() >= 80 ? "读得不错！🐾 " : "读完啦！有几个地方再读读。 " }}</b>读准了 {{ pct() }}%，每分钟 {{ result.cpm }} 字。
        </template>
        <!-- the first week: no score, just the joy of reading out loud -->
        <b v-else>{{ pct() >= 80 ? "读得真响亮！小猎犬听得很开心 🐾" : "读完啦！小猎犬听到了 🐾" }}</b>
      </div>
      <div v-if="result.practise.length" style="margin-top: 10px">
        <span class="muted">这几个地方再读读（点一下听）：</span>
        <button v-for="w in result.practise" :key="w" class="small soft" style="margin: 4px" @click="speak(w)">🔊 {{ w }}</button>
      </div>
    </div>
    <div class="row center" style="margin-top: 12px">
      <button v-if="supported" class="big" :disabled="state === 'checking' || left <= 0" @click="toggle">
        {{ state === "recording" ? "⏹ 读完了" : again ? "🎙 再读一遍" : "🎙 开始读" }}
      </button>
      <button class="ghost" @click="$emit('close')">接着读</button>
    </div>
  </Modal>
</template>
