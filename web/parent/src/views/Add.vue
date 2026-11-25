<script setup>
import { ref, reactive } from "vue";
import { useRouter } from "vue-router";
import { api, toast, attempt } from "../api.js";
import { GENRES } from "../labels.js";
import { usePipeline } from "../pipeline.js";

const router = useRouter();
const classics = ref(await api("GET", "/api/parent/classics"));

// 经典故事改写
const cl = reactive({ category: classics.value.categories.find((c) => c.left)?.key || "", count: 10 });
async function queueClassics() {
  await attempt(async () => {
    const r = await api("POST", "/api/parent/classics", { category: cl.category, count: Number(cl.count) });
    toast(`已排队 ${r.queued.length} 篇：${r.queued.slice(0, 4).join("、")}${r.queued.length > 4 ? "……" : ""}`, 4000);
    classics.value = await api("GET", "/api/parent/classics");
  });
}

// AI 定制故事
const gen = reactive({ hero: "1", genre: "story", theme: "", focus: "" });
const { progress, run } = usePipeline();
async function generate() {
  await attempt(async () => {
    const r = await api("POST", "/api/parent/generate", { hero: gen.hero === "1", genre: gen.genre, theme: gen.theme, focus: gen.focus || null });
    toast(`已开始写 #${r.id}，目标字：${r.spec.targets.join("") || "无"}`, 3500);
    await run();
    router.push(`/library/${r.id}`);
  });
}
const FOCUS = [["extract", "信息提取"], ["infer", "推断"], ["summarise", "概括"], ["theme", "道理体会"], ["word", "词语理解"], ["locate", "回文定位"]];

// 录入一篇
const one = reactive({ title: "", genre: "", source: "", body: "" });
async function addOne() {
  await attempt(async () => {
    const r = await api("POST", "/api/parent/articles", { ...one });
    toast(r.duplicate ? `已存在（#${r.duplicate}）` : `已加入队列 #${r.id}`);
    if (!r.duplicate) Object.assign(one, { title: "", body: "" });
  });
}

// 批量导入
const bulk = reactive({ text: "", source: "" });
async function readFile(e) {
  const f = e.target.files[0];
  if (f) bulk.text = await f.text();
}
async function addBulk() {
  await attempt(async () => {
    const r = await api("POST", "/api/parent/articles/bulk", { text: bulk.text, source: bulk.source });
    toast(`导入 ${r.results.filter((x) => x.id).length} 篇，重复 ${r.results.filter((x) => x.duplicate).length} 篇`);
  });
}

// 维基文库
const ws = reactive({ title: "", genre: "" });
async function importWs() {
  await attempt(async () => {
    const r = await api("POST", "/api/parent/import/wikisource", { ...ws });
    toast(r.duplicate ? "已存在" : `已加入队列 #${r.id}`);
  });
}
</script>

<template>
  <div class="card">
    <h2>经典故事改写（书库快速充实）</h2>
    <p class="muted">成语、神话、寓言、童话、历史和科普的经典故事都是公版，由 AI 按孩子当前的识字量用自己的话重新讲一遍——没有版权顾虑，难度也正合适。排队后每天按 AI 额度自动处理（约 7–10 篇/天），也可在“书库”点“立即处理队列”。</p>
    <div class="row">
      <div style="flex: 1; min-width: 220px">
        <select v-model="cl.category">
          <option v-for="c in classics.categories" :key="c.key" :value="c.key" :disabled="!c.left">{{ c.name }}（还剩 {{ c.left }} / {{ c.total }} 篇）</option>
        </select>
      </div>
      <input v-model="cl.count" type="number" min="1" max="30" style="width: 90px" />
      <span class="muted">篇</span>
      <Btn :action="queueClassics">排队</Btn>
    </div>
  </div>

  <div class="card">
    <h2>AI 定制故事</h2>
    <p class="muted">按孩子当前的识字量写一篇：复习到期的生字、引入下一批该学的字，超纲的字会让 AI 改写掉。写完照常走适龄审核和出题。主角设定在“设置”里。</p>
    <div class="grid2">
      <div><label>主角</label><select v-model="gen.hero"><option value="1">孩子自己当主角</option><option value="0">不指定主角</option></select></div>
      <div><label>题材</label><select v-model="gen.genre"><option v-for="k in ['story', 'fairy', 'fable', 'science', 'life', 'myth']" :key="k" :value="k">{{ GENRES[k] }}</option></select></div>
    </div>
    <label>主题</label>
    <input v-model="gen.theme" placeholder="主题，可留空，如：去海边捡贝壳、第一次养蚕" />
    <div style="margin-top: 8px">
      <select v-model="gen.focus">
        <option value="">侧重能力：按最近的弱项自动选</option>
        <option v-for="[k, v] in FOCUS" :key="k" :value="k">{{ v }}</option>
      </select>
    </div>
    <div class="row end" style="margin-top: 10px"><Btn :action="generate">{{ progress || "写一篇" }}</Btn></div>
  </div>

  <div class="card">
    <h2>录入一篇</h2>
    <div class="grid2">
      <div><label>标题</label><input v-model="one.title" placeholder="标题" /></div>
      <div>
        <label>题材</label>
        <select v-model="one.genre"><option value="">题材（可留空，AI 判断）</option><option v-for="(v, k) in GENRES" :key="k" :value="k">{{ v }}</option></select>
      </div>
    </div>
    <label>来源</label><input v-model="one.source" placeholder="来源，如：快乐读书吧《中国神话传说》" />
    <label>正文</label><textarea v-model="one.body" placeholder="正文，一段一行。建议 600–900 字。" />
    <div class="row end" style="margin-top: 10px"><Btn :action="addOne">加入书库</Btn></div>
  </div>

  <div class="card">
    <h2>批量导入（txt）</h2>
    <p class="muted">每篇以一行“=== 标题”开头。适合自家藏书导出的文本、OCR 结果。</p>
    <input type="file" accept=".txt,text/plain" @change="readFile" />
    <label>来源</label><input v-model="bulk.source" placeholder="来源（整批）" />
    <label>内容</label><textarea v-model="bulk.text" :placeholder="'=== 第一篇标题\n正文……\n\n=== 第二篇标题\n正文……'" />
    <div class="row end" style="margin-top: 10px"><Btn :action="addBulk">批量导入</Btn></div>
  </div>

  <div class="card">
    <h2>从维基文库导入（公版）</h2>
    <p class="muted">按页面标题抓取一页正文（低频、单页）。繁体会自动转为简体再分析；文言文通常会因句式和用字被淘汰或标为待复核。</p>
    <div class="grid2">
      <input v-model="ws.title" placeholder="维基文库页面标题，例如：伊索寓言/狐狸和葡萄" />
      <select v-model="ws.genre"><option value="">题材（可留空，AI 判断）</option><option v-for="(v, k) in GENRES" :key="k" :value="k">{{ v }}</option></select>
    </div>
    <div class="row end" style="margin-top: 10px"><Btn :action="importWs">导入</Btn></div>
  </div>

  <p class="muted" style="font-size: 14px">资源只进不出：所有文章只存在你的 Cloudflare D1 里，不进代码仓库、不外传。</p>
</template>
