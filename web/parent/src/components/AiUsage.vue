<script setup>
import { computed } from "vue";
import { AI_PURPOSE } from "../labels.js";
const props = defineProps({ u: { type: Object, required: true } });
const days = computed(() => [...new Set(props.u.rows.map((r) => r.day))]);
const cell = (d, k) => props.u.rows.find((x) => x.day === d && x.purpose === k);
</script>

<template>
  <div class="card">
    <h2>AI 用量</h2>
    <p class="muted" style="font-size: 14px">
      今天（UTC {{ u.today }}）入库已用 {{ u.ingestToday }}{{ u.limit ? ` / ${u.limit}` : "" }} 次。免费额度每天 1 万 neurons，北京时间 8 点重置。
      <template v-if="u.paused">　⏸ 暂停中（{{ u.paused.reason === "budget" ? "到上限" : "额度用完" }}）</template>
    </p>
    <table v-if="days.length">
      <tr><th>日期</th><th v-for="p in AI_PURPOSE" :key="p">{{ p }}</th></tr>
      <tr v-for="d in days" :key="d">
        <td>{{ d.slice(5) }}</td>
        <td v-for="(_, k) in AI_PURPOSE" :key="k" :title="cell(d, k) ? `输入 ${cell(d, k).in_chars} 字符 / 输出 ${cell(d, k).out_chars} 字符` : ''">
          <template v-if="cell(d, k)">{{ cell(d, k).calls }}{{ cell(d, k).failures ? `（败 ${cell(d, k).failures}）` : "" }}</template>
        </td>
      </tr>
    </table>
    <p v-else class="muted">最近 7 天还没有调用。</p>
  </div>
</template>
