<!-- A story read before, opened from the archive card, with the character marked. -->
<script setup>
import { ref, onMounted, nextTick } from "vue";
import { useRouter } from "vue-router";
import { api } from "../lib/api.js";
import ParaText from "../components/ParaText.vue";

const props = defineProps({ id: Number, focus: String });
const router = useRouter();
const a = ref(null);
const err = ref("");
onMounted(async () => {
  try {
    a.value = await api("GET", `/api/articles/${props.id}`);
    await nextTick();
    document.querySelector(".hz.new")?.closest(".para")?.scrollIntoView({ block: "center" });
  } catch (e) {
    err.value = e.offline ? "需要联网才能打开这篇故事。" : e.message;
  }
});
const back = () => (window.history.state?.back ? router.back() : router.push("/collection"));
</script>

<template>
  <div class="reader-head">
    <button class="ghost small" @click="back">← 返回</button>
    <div class="t">{{ a?.title || "" }}</div>
  </div>
  <p v-if="err" class="card center">{{ err }}</p>
  <ParaText v-for="(p, i) in a?.paragraphs || []" :key="i" :p="p" :i="i" :new-set="new Set(focus ? [focus] : [])" />
</template>
