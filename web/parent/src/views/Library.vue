<script setup>
import { ref, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../api.js";
import { STATUS, pct } from "../labels.js";
import { usePipeline } from "../pipeline.js";

const route = useRoute();
const router = useRouter();
const status = route.query.status || "";
const load = () => api("GET", "/api/parent/articles" + (status ? `?status=${status}` : ""));
const d = ref(await load());
const pending = computed(() => (d.value.counts.queued || 0) + (d.value.counts.processing || 0));
const { progress, run } = usePipeline(async () => (d.value = await load()));
const filters = [["", "全部"], ...Object.entries(STATUS)];
const pausedUntil = computed(() => d.value.aiPaused && new Date(d.value.aiPaused.until).toLocaleString("zh-CN", { hour12: false }));
</script>

<template>
  <div v-if="d.aiPaused" class="card" style="background: var(--accent-soft)">
    ⏸ {{ d.aiPaused.reason === "budget" ? "今天入库的 AI 调用已到上限（可在“设置”里调整）" : "Workers AI 今天的免费额度已用完" }}，入库暂停，{{ pausedUntil }} 自动继续。排队的文章不会被判失败。
  </div>
  <div class="card">
    <div class="row">
      <div class="row">
        <RouterLink v-for="[k, label] in filters" :key="k" :to="{ path: '/library', query: k ? { status: k } : {} }" custom v-slot="{ navigate }">
          <button class="small" :class="{ ghost: k !== status }" @click="navigate">{{ label }}{{ k && d.counts[k] ? ` ${d.counts[k]}` : "" }}</button>
        </RouterLink>
      </div>
      <span class="spacer" />
      <Btn v-if="pending || progress" class="small" :action="run">{{ progress || `立即处理队列（${pending}）` }}</Btn>
    </div>
    <p class="muted" style="font-size: 14px">入库流程：硬指标（覆盖率、句长、字数）→ AI 适龄评估 → 拼音 → 生字卡 → 出题 → 朗读音频。定时任务每 30 分钟自动处理一次。</p>
  </div>
  <div class="card">
    <table v-if="d.articles.length" class="clickable">
      <tr><th v-for="x in ['#', '标题', '状态', '字数', '难度', '覆盖率', '点评 / 原因']" :key="x">{{ x }}</th></tr>
      <tr v-for="a in d.articles" :key="a.id" data-href @click="router.push(`/library/${a.id}`)">
        <td>{{ a.id }}</td>
        <td>{{ a.title }}<div class="muted small-note">{{ a.genreName || "" }}</div></td>
        <td>
          <span class="pill" :class="a.status">{{ STATUS[a.status] }}</span>
          <div v-if="a.status === 'processing'" class="muted small-note">{{ a.stage }}</div>
        </td>
        <td>{{ a.char_count || "—" }}</td>
        <td>{{ a.difficulty ?? "—" }}</td>
        <td>{{ pct(a.coverage) }}</td>
        <td style="font-size: 14px">{{ a.reject_reason || a.ai_note || "" }}<div v-if="a.last_error" class="muted">{{ a.last_error }}</div></td>
      </tr>
    </table>
    <p v-else class="muted">书库是空的，去“<RouterLink to="/add">添加文章</RouterLink>”放几篇进来吧。</p>
  </div>
</template>
