<script setup>
import { ref, computed } from "vue";
import { api, toast } from "../api.js";
import { LEVEL, pct } from "../labels.js";
import RadarChart from "../components/RadarChart.vue";
import LineChart from "../components/LineChart.vue";
import AiUsage from "../components/AiUsage.vue";

const [report, usage] = await Promise.all([api("GET", "/api/parent/report"), api("GET", "/api/parent/ai-usage")]);
const r = ref(report);
const last = computed(() => r.value.curve[r.value.curve.length - 1]);

async function requestRetest() {
  await api("POST", "/api/parent/assessment/request");
  toast("孩子下次打开时会重新测评");
  r.value = await api("GET", "/api/parent/report");
}
const note = "font-size:13px";
</script>

<template>
  <div class="kpi">
    <div class="stat"><b>{{ r.streak }}</b><span>连续天数</span></div>
    <div class="stat"><b>{{ r.weekDone }}/7</b><span>近 7 天完成</span></div>
    <div class="stat"><b>{{ last ? last.known : "—" }}</b><span>认识的字</span></div>
    <div class="stat"><b>{{ r.dueReview }}</b><span>待复习生字</span></div>
  </div>

  <div class="card" style="margin-top: 16px">
    <h2>建议</h2>
    <ul><li v-for="s in r.suggestion" :key="s">{{ s }}</li></ul>
  </div>

  <div class="grid2">
    <div class="card">
      <h2>能力雷达（近 60 天首答正确率）</h2>
      <RadarChart :items="r.radar" />
      <p class="muted" style="font-size: 14px">{{ r.radar.map((x) => `${x.name} ${x.correct}/${x.total}`).join(" · ") }}</p>
    </div>
    <div class="card">
      <h2>识字量曲线</h2>
      <LineChart :rows="r.curve" />
      <!-- baseline test status, with a one-tap re-test -->
      <div class="row" style="font-size: 14px; margin: 6px 0">
        <span v-if="!r.assessment" class="muted">识字测评还没做完：孩子打开孩子端时会接着测（中途停下的进度存在平板上）。</span>
        <span v-else-if="r.assessmentRequested" class="muted">已安排重新测评，孩子下次打开时开始。上次估计：{{ r.assessment.estimate }} 字（{{ r.assessment.at.slice(0, 10) }}）</span>
        <template v-else>
          <span class="muted">测评估计：{{ r.assessment.estimate }} 字，约到统编版{{ r.assessment.reached }}（{{ r.assessment.at.slice(0, 10) }}）</span>
          <span class="spacer" />
          <Btn class="small soft" :action="requestRetest">重新测评</Btn>
        </template>
      </div>
      <h3>本月新驯服 {{ r.newMastered.length }} 个</h3>
      <div class="chars-inline">{{ r.newMastered.map((c) => c.char).join("") || "—" }}</div>
    </div>
  </div>

  <AiUsage :u="usage" />

  <div class="card">
    <h2>阅读履历</h2>
    <table v-if="r.history.length">
      <tr><th v-for="x in ['日期', '文章', '状态', '用时', '速度', '点读', '首答正确率', '生字', '骨头']" :key="x">{{ x }}</th></tr>
      <template v-for="s in r.history" :key="s.id">
        <tr>
          <td>{{ s.date }} <span v-if="!s.daily" class="pill">加读</span></td>
          <td>
            <RouterLink :to="`/library/${s.articleId}`">{{ s.title }}</RouterLink>
            <div class="muted" :style="note">{{ s.genre || "" }} {{ s.chars }} 字</div>
          </td>
          <td>
            {{ LEVEL[s.level] }}
            <div v-if="s.verdict?.recovered" class="muted" :style="note">回看后答对</div>
            <div v-if="s.verdict?.tooFast" class="muted" :style="note">⚠ 读得偏快</div>
          </td>
          <td>{{ s.minutes }} 分</td>
          <td>{{ s.verdict?.speed ? `${s.verdict.speed} 字/分` : "—" }}</td>
          <td>{{ s.taps }}<div v-if="s.tapped" class="muted" :style="note">{{ s.tapped }}</div></td>
          <td>{{ pct(s.accuracy) }}</td>
          <td>
            {{ s.charTotal ? `${s.verdict?.charFirstOk ?? s.charOk}/${s.charTotal}` : "—" }}
            <div v-if="s.verdict && s.verdict.charFirstOk != null && s.charOk > s.verdict.charFirstOk" class="muted" :style="note">再见一面后 {{ s.charOk }}/{{ s.charTotal }}</div>
          </td>
          <td>{{ s.bones || 0 }}</td>
        </tr>
        <tr v-if="s.fluency">
          <td />
          <td colspan="8" class="muted" style="font-size: 14px">🎙 朗读 {{ s.fluency.paras }} 段：读准 {{ s.fluency.accuracy }}%，每分钟 {{ s.fluency.cpm }} 字</td>
        </tr>
        <tr v-if="s.retell">
          <td />
          <td colspan="8">
            <details>
              <summary class="muted">🎤 复述：讲到 {{ s.retell.covered.length }}/{{ s.retell.total }} 个要点</summary>
              <div style="margin: 6px 0">转写：{{ s.retell.transcript }}</div>
              <div class="muted">讲到：{{ s.retell.covered.join("；") || "—" }}</div>
            </details>
          </td>
        </tr>
        <tr v-if="s.wrong.length">
          <td />
          <td colspan="8">
            <details>
              <summary class="muted">错题 {{ s.wrong.length }}</summary>
              <div v-for="(w, i) in s.wrong" :key="i" style="margin: 6px 0">
                <span class="pill">{{ w.ability }}</span> {{ w.prompt }}（第 {{ w.attempt }} 次）选了「{{ w.chose }}」，正确是「{{ w.right }}」
              </div>
            </details>
          </td>
        </tr>
      </template>
    </table>
    <p v-else class="muted">还没有阅读记录。</p>
  </div>
</template>
