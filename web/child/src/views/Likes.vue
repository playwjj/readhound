<!-- 我喜欢读…: the child picks the kinds of stories it likes; the daily pick leans toward them. -->
<script setup>
import { ref } from "vue";
import { useRouter } from "vue-router";
import { api, toast } from "../lib/api.js";
import { app, refreshHome } from "../state.js";
import PageHead from "../components/PageHead.vue";

const CHOICES = [
  ["动物", "🐾"], ["科学", "🔬"], ["冒险", "🧭"], ["搞笑", "😄"], ["历史", "🏯"], ["太空", "🚀"],
  ["友情", "🤝"], ["侦探", "🔍"], ["神话", "🐉"], ["恐龙", "🦕"], ["自然", "🌳"], ["运动", "⚽"],
];
const MAX = 6;
const router = useRouter();
const picked = ref(new Set((app.home?.interests || []).filter((t) => CHOICES.some(([c]) => c === t))));
function toggle(t) {
  const s = new Set(picked.value);
  if (s.has(t)) s.delete(t);
  else if (s.size < MAX) s.add(t);
  else return toast(`最多选 ${MAX} 个`);
  picked.value = s;
}
async function save() {
  try {
    await api("PUT", "/api/interests", { tags: [...picked.value] });
  } catch (e) {
    if (e.message !== "login") toast(e.offline ? "需要联网才能保存" : e.message);
    return;
  }
  toast("记住啦！小猎犬会多找这样的故事");
  await refreshHome();
  router.push("/");
}
</script>

<template>
  <PageHead title="我喜欢读……" />
  <div class="card center">
    <p style="font-size: 20px">你喜欢什么样的故事？选几个（最多 {{ MAX }} 个），小猎犬会多帮你找。</p>
    <div class="likes">
      <button v-for="[t, ico] in CHOICES" :key="t" class="like" :class="{ on: picked.has(t) }" @click="toggle(t)">
        <span class="ico">{{ ico }}</span>{{ t }}
      </button>
    </div>
    <Btn class="big" :action="save">{{ picked.size ? "就这些！" : "先不选" }}</Btn>
  </div>
</template>
