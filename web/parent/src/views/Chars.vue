<script setup>
import { ref, reactive, computed } from "vue";
import { useRoute } from "vue-router";
import { api, toast, attempt } from "../api.js";

const route = useRoute();
const st = route.query.cs || "seen";
const loadChars = () => api("GET", `/api/parent/chars?status=${st}`);
const [c0, t0] = await Promise.all([loadChars(), api("GET", "/api/parent/textbook")]);
const d = ref(c0);
const tb = ref(t0);
const counts = computed(() => {
  const out = {};
  for (const c of d.value.counts) out[c.status] = (out[c.status] || 0) + c.n;
  return out;
});
const byOrigin = (o) => d.value.chars.filter((c) => c.origin === o).length;
const NAMES = { seen: "见过", familiar: "认识", mastered: "掌握" };

async function retest() {
  await attempt(async () => {
    await api("POST", "/api/parent/assessment/request");
    toast("孩子下次打开时会重新测评");
  });
}
const sync = reactive({ unit: "", text: "" });
async function textbook(mode) {
  await attempt(async () => {
    const r = await api("POST", "/api/parent/textbook", { text: sync.text, unit: sync.unit, mode });
    toast(mode === "known" ? `已计入已知 ${r.count} 字` : `已加入 ${r.count} 字`);
    [d.value, tb.value] = await Promise.all([loadChars(), api("GET", "/api/parent/textbook")]);
  });
}
async function clearTextbook() {
  await attempt(async () => {
    await api("DELETE", "/api/parent/textbook");
    tb.value = await api("GET", "/api/parent/textbook");
  });
}
const mark = reactive({ chars: "", status: "familiar" });
async function saveMark() {
  await attempt(async () => {
    const r = await api("POST", "/api/parent/chars", { ...mark });
    toast(`已更新 ${r.count} 字`);
    d.value = await loadChars();
  });
}
</script>

<template>
  <div class="card">
    <div class="row">
      <RouterLink v-for="k in ['seen', 'familiar', 'mastered']" :key="k" :to="{ path: '/chars', query: { cs: k } }" custom v-slot="{ navigate }">
        <button class="small" :class="{ ghost: k !== st }" @click="navigate">{{ NAMES[k] }} {{ counts[k] || 0 }}</button>
      </RouterLink>
      <span class="spacer" />
      <Btn class="small soft" :action="retest">安排重新测评</Btn>
    </div>
    <template v-if="st === 'familiar'">
      <p class="muted">其中来自测评推断的 {{ byOrigin("inferred") }} 个、测评答对 {{ byOrigin("assessment") }} 个、阅读中学会 {{ byOrigin("reading") }} 个。</p>
      <div class="chars-inline">{{ d.chars.map((c) => c.char).join("") }}</div>
    </template>
    <table v-else>
      <tr><th v-for="x in ['字', '拼音', '释义', '首次见到', '下次复习', '答对篇数', '答错']" :key="x">{{ x }}</th></tr>
      <tr v-for="c in d.chars" :key="c.char">
        <td style="font-size: 22px">{{ c.char }}</td><td>{{ c.pinyin || "" }}</td><td>{{ c.gloss || "" }}</td>
        <td>{{ c.first_seen_at || "" }}</td><td>{{ c.due_at || "—" }}</td><td>{{ c.correctArticles }}</td><td>{{ c.lapses }}</td>
      </tr>
    </table>
  </div>

  <div class="grid2">
    <div class="card">
      <h2>课本同步生字</h2>
      <p class="muted">“正在学”的字会让选文向它们倾斜（提前混脸熟）；“已学会”的字直接计入已知字表。</p>
      <label>单元</label><input v-model="sync.unit" placeholder="单元，如：四上第三单元" />
      <label>生字</label><textarea v-model="sync.text" style="min-height: 90px" placeholder="把课本某单元的生字表粘贴进来（只取汉字）" />
      <div class="row end" style="margin-top: 10px">
        <Btn class="ghost small" :action="() => textbook('known')">这些已学会</Btn>
        <Btn class="small" :action="() => textbook('upcoming')">正在学 / 即将学</Btn>
      </div>
      <div v-if="tb.chars.length">
        <h3>正在学（{{ tb.chars.length }}）</h3>
        <div class="chars-inline">{{ tb.chars.map((c) => c.char).join("") }}</div>
        <Btn class="ghost small" :action="clearTextbook">清空</Btn>
      </div>
    </div>
    <div class="card">
      <h2>手动标记</h2>
      <p class="muted">发现测评不准时手动修正。阅读中学到的字不会被“不认识”删掉。</p>
      <input v-model="mark.chars" placeholder="要标记的字" />
      <div style="margin-top: 8px">
        <select v-model="mark.status">
          <option value="familiar">认识</option><option value="mastered">已掌握</option><option value="unknown">不认识（移出已知字表）</option>
        </select>
      </div>
      <div class="row end" style="margin-top: 10px"><Btn :action="saveMark">保存</Btn></div>
    </div>
  </div>
</template>
