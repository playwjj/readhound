<script setup>
import { reactive } from "vue";
import { api, toast, attempt } from "../api.js";
import { GENRES, hanCount } from "../labels.js";

const props = defineProps({ unit: { type: Object, required: true }, skills: Object, genres: Array });
const emit = defineEmits(["saved"]);
const u = props.unit;
const f = reactive({
  theme: u.theme || "", focus: u.focus || "", lessons: u.lessons || "", topics: u.topics || "",
  skill: u.skill || "", genre: u.genre || "", recognise: u.recognise || "", write: u.write || "", verified: u.verified ? "1" : "0",
});
async function save() {
  await attempt(async () => {
    await api("PUT", "/api/parent/units", { volume: u.volume, unit: u.unit, ...f, verified: f.verified === "1" });
    toast("已保存");
    emit("saved");
  });
}
</script>

<template>
  <div style="margin-top: 12px">
    <div class="grid2">
      <div><label>单元主题</label><input v-model="f.theme" /></div>
      <div><label>语文要素（单元导语）</label><input v-model="f.focus" /></div>
    </div>
    <label>课文</label><textarea v-model="f.lessons" style="min-height: 60px" />
    <div class="grid2">
      <div><label>选文关键词</label><input v-model="f.topics" /><div class="muted small-note">顿号分隔；书库里标题或标签含这些词的文章会优先</div></div>
      <div class="grid2">
        <div><label>侧重能力</label><select v-model="f.skill"><option value="">—</option><option v-for="(v, k) in skills" :key="k" :value="k">{{ v }}</option></select></div>
        <div><label>偏向题材</label><select v-model="f.genre"><option value="">—</option><option v-for="g in genres" :key="g" :value="g">{{ GENRES[g] || g }}</option></select></div>
      </div>
    </div>
    <div class="grid2">
      <div><label>识字表（{{ hanCount(f.recognise) }} 字）</label><textarea v-model="f.recognise" style="min-height: 60px" placeholder="书末“识字表”本单元的字：拍照后用 iPad 的实况文本复制，直接粘贴" /></div>
      <div><label>写字表（{{ hanCount(f.write) }} 字）</label><textarea v-model="f.write" style="min-height: 60px" placeholder="书末“写字表”本单元的字" /></div>
    </div>
    <div class="row end" style="margin-top: 10px">
      <div><select v-model="f.verified"><option value="0">还没核对</option><option value="1">已按孩子的课本核对</option></select></div>
      <Btn class="small" :action="save">保存</Btn>
    </div>
  </div>
</template>
