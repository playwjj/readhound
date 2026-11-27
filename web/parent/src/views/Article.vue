<script setup>
import { ref, computed } from "vue";
import { useRouter } from "vue-router";
import { api, toast, attempt } from "../api.js";
import { STATUS, LEVEL, pct } from "../labels.js";

const props = defineProps({ id: { type: Number, required: true } });
const router = useRouter();
const load = () => api("GET", `/api/parent/articles/${props.id}`);
const a = ref(await load());

async function act(action, confirmMsg) {
  if (confirmMsg && !confirm(confirmMsg)) return;
  await attempt(async () => {
    await api("POST", `/api/parent/articles/${props.id}/${action}`);
    toast("已完成");
    if (action === "delete") return router.push("/library");
    a.value = await load();
  });
}
function back() {
  // back to the list the parent came from (keeps its filter); a direct link goes to the library
  if (window.history.state?.back?.startsWith("/library")) router.back();
  else router.push("/library");
}

const meta = computed(() => [a.value.genreName, `${a.value.char_count} 字`, `难度 ${a.value.difficulty ?? "—"}`, `覆盖率 ${pct(a.value.coverage)}`,
  `平均句长 ${a.value.avg_sentence_len ?? "—"}`, `最长句 ${a.value.max_sentence_len ?? "—"}`].filter(Boolean).join(" · "));
const tier = computed(() => ({
  cls: { pass: "ready", review: "queued", later: "rejected" }[a.value.tierForChild],
  text: { pass: `合适（${a.value.newForChild.length} 个）`, review: `偏难（${a.value.newForChild.length} 个）`, later: `暂缓（${a.value.newForChild.length} 个，等识字量涨上来）` }[a.value.tierForChild],
}));
const KIND = { guess: "猜词义", predict: "预测", locate: "回文定位", section: "概括段意" };
const where = (q) => q.kind === "predict" ? `读完第 ${q.meta.after + 1} 段停下预测，第 ${q.meta.reveal + 1} 段揭晓（不计入通关判定）`
  : q.kind === "section" ? null
  : q.evidence != null ? `依据：第 ${q.evidence + 1} 段` : null;

// text with pinyin: tap a character to put it into the fix form
const word = ref("");
const py = ref("");
const wordInput = ref(null);
const paras = computed(() => a.value.paragraphs.map((p, i) => {
  const syl = (a.value.pinyinParas[i] || "").split(" ");
  let k = 0;
  return [...p].map((ch) => (/\p{Script=Han}/u.test(ch) ? { ch, py: syl[k++] || "" } : { ch }));
}));
function pickChar(c) {
  word.value = c.ch;
  py.value = c.py;
  wordInput.value?.focus();
}
async function saveFix() {
  await attempt(async () => {
    const r = await api("POST", "/api/parent/pinyin-fix", { word: word.value, pinyin: py.value });
    toast(`已保存，更新了 ${r.updated} 篇文章`);
    a.value = await load();
  });
}
</script>

<template>
  <button class="ghost small" @click="back">← 返回书库</button>
  <div class="card" style="margin-top: 12px">
    <h2>{{ a.title }} <span class="pill" :class="a.status">{{ STATUS[a.status] }}</span></h2>
    <p class="muted">{{ meta }}</p>
    <p v-if="a.ai_note">AI 点评：{{ a.ai_note }}{{ a.tags.length ? `（${a.tags.join("、")}）` : "" }}</p>
    <div v-if="a.genSpec" class="surprise" style="font-size: 15px">
      <b>{{ a.genSpec.auto ? "🤖 书库补位，AI 生成" : "✍️ AI 定制故事" }}</b>
      {{ a.genSpec.hero ? `（主角：${a.genSpec.hero.name}）` : "" }}
      <div>目标字：{{ (a.genSpec.targets || []).join("") || "—" }}；实际用上：{{ (a.genSpec.targetsUsed || []).join("") || "—" }}</div>
      <div v-if="a.genSpec.rounds">生成与改写：{{ a.genSpec.rounds.map((r, i) => `${i ? `第 ${i} 次改写` : "初稿"} ${r.len} 字、超纲 ${r.extra} 个${r.hard ? `（${r.hard}）` : ""}`).join(" → ") }}</div>
    </div>
    <p v-if="a.reject_reason" style="color: var(--accent)">{{ a.reject_reason }}</p>
    <p v-if="a.last_error" class="muted">最近错误：{{ a.last_error }}</p>
    <div class="row">
      <Btn v-if="a.status === 'flagged'" class="small" :action="() => act('approve')">我看过了，放行</Btn>
      <Btn v-if="a.status === 'ready'" class="small" :action="() => act('pick')">设为今日一篇</Btn>
      <Btn v-if="a.status === 'rejected'" class="small" :action="() => act('force')">忽略硬指标，强制入库</Btn>
      <Btn class="small ghost" :action="() => act('requeue')">重新处理</Btn>
      <Btn v-if="a.status !== 'retired'" class="small ghost" :action="() => act('retire')">下架</Btn>
      <Btn class="small ghost" :action="() => act('delete', '永久删除这篇文章？')">删除</Btn>
    </div>
  </div>

  <div class="grid2">
    <div class="card">
      <h2>对孩子来说的生字 <span class="pill" :class="tier.cls">{{ tier.text }}</span></h2>
      <div v-if="a.newForChild.length <= 40" class="chars-inline">{{ a.newForChild.join(" ") || "（没有：全都认识）" }}</div>
      <!-- a long list (an article far beyond the child) folds, in rows of ten -->
      <details v-else>
        <summary class="muted">{{ a.newForChild.length }} 个，展开看</summary>
        <div class="chars-grid"><span v-for="c in a.newForChild" :key="c">{{ c }}</span></div>
      </details>
      <p v-if="a.rareForChild.length" class="muted">生僻字（只给拼音，不作为目标）：{{ a.rareForChild.join("") }}</p>
      <h3>生字卡</h3>
      <table>
        <tr v-for="g in a.glosses" :key="g.char"><td style="font-size: 22px">{{ g.char }}</td><td>{{ g.pinyin }}</td><td>{{ g.word }}</td><td>{{ g.gloss || "—" }}</td></tr>
      </table>
    </div>
    <div class="card">
      <h2>闯关题</h2>
      <p v-if="a.purpose"><b>读前任务：</b>{{ a.purpose.task }}</p>
      <div v-for="q in a.questions" :key="q.id" style="margin-bottom: 12px">
        <span class="pill">{{ KIND[q.kind] || q.abilityName }}</span> <b>{{ q.prompt }}</b>
        <div v-if="q.kind === 'locate'">
          依据句：<span style="color: var(--good); font-weight: 600">（第 {{ q.meta.para + 1 }} 段）{{ q.options[q.meta.sentence] || "" }}</span>
          <div v-if="q.explain" class="muted">答案：{{ q.explain }}</div>
        </div>
        <ol v-else type="A" style="margin: 4px 0">
          <li v-for="(o, i) in q.options" :key="i" :style="i === q.answer ? 'color:var(--good);font-weight:600' : ''">{{ o }}</li>
        </ol>
        <div v-if="where(q)" class="muted small-note">{{ where(q) }}</div>
      </div>
    </div>
  </div>

  <div class="card">
    <h2>正文与拼音</h2>
    <p v-if="a.polyphones_fixed != null" class="muted" style="font-size: 14px">AI 核对多音字时改正了 {{ a.polyphones_fixed }} 处。点任意一个字可填入下面的纠错框。</p>
    <p v-for="(p, i) in paras" :key="i" class="py-view">
      <span class="muted">[{{ i + 1 }}] </span>
      <template v-for="(c, j) in p" :key="j">
        <ruby v-if="c.py !== undefined" title="点一下填入纠错框" @click="pickChar(c)">{{ c.ch }}<rt>{{ c.py }}</rt></ruby>
        <template v-else>{{ c.ch }}</template>
      </template>
    </p>
    <div class="row" style="margin-top: 12px">
      <div style="flex: 1; min-width: 140px"><input ref="wordInput" v-model="word" placeholder="词语，如：长着" /></div>
      <div style="flex: 2; min-width: 180px"><input v-model="py" placeholder="正确拼音，如：zhǎng zhe" /></div>
      <Btn class="small" :action="saveFix">纠正读音</Btn>
    </div>
    <p class="muted small-note">纠错按词语生效：书库里所有含这个词的文章都会改过来，以后入库的文章也会用它。</p>
  </div>

  <div v-if="a.reads.length" class="card">
    <h2>阅读记录</h2>
    <div v-for="(r, i) in a.reads" :key="i">{{ r.date }} · {{ LEVEL[r.level] }} · 正确率 {{ pct(r.accuracy) }} · {{ Math.round(r.active_ms / 60000) }} 分钟</div>
  </div>
</template>
