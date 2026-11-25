<!-- Archive card: a character's status and the stories it appeared in. -->
<script setup>
import { ref, watch } from "vue";
import { useRouter } from "vue-router";
import { app } from "../state.js";
import { api } from "../lib/api.js";
import { speak } from "../lib/voice.js";
import Modal from "./Modal.vue";

const router = useRouter();
const c = ref(null);
watch(() => app.card, async (ch) => {
  c.value = null;
  if (!ch) return;
  try {
    const d = await api("GET", `/api/chars/${encodeURIComponent(ch)}`);
    if (app.card === ch) c.value = d;
  } catch {
    app.card = null;
  }
}, { immediate: true });
const STATUS = { unseen: "还没见过", seen: "见过", familiar: "认识", mastered: "已驯服" };
const esc = (s) => String(s).replace(/[&<>"]/g, (x) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[x]);
const snippet = (s) => esc(s.snippet).replaceAll(c.value.char, `<mark>${c.value.char}</mark>`);
function open(s) {
  app.card = null;
  router.push({ path: `/reread/${s.articleId}`, query: { c: c.value.char } });
}
</script>

<template>
  <Modal v-if="app.card && c" dismissable @close="app.card = null">
    <div class="row">
      <div class="ccard" style="min-width: 120px"><div class="big">{{ c.char }}</div><div class="py">{{ c.pinyin }}</div></div>
      <div>
        <div><b>{{ STATUS[c.status] }}</b><span v-if="c.firstSeenAt" class="muted"> · {{ c.firstSeenAt }} 第一次见</span></div>
        <div v-if="c.word">{{ c.word }}</div>
        <div v-if="c.gloss" class="muted">{{ c.gloss }}</div>
        <div v-if="c.status !== 'mastered' && c.status !== 'unseen'" class="muted" style="font-size: 15px">在 {{ c.correctArticles }} 篇文章里答对过（3 篇就驯服啦）</div>
        <div v-if="c.textbook?.recognise" class="muted" style="font-size: 15px">课本：{{ c.textbook.recognise }}认识{{ c.textbook.write ? `，${c.textbook.write}会写` : "" }}</div>
      </div>
      <span class="spacer" />
      <button class="icon soft" @click="speak(c.word || c.char)">🔊</button>
    </div>
    <h3>🐾 在这些故事里见过（{{ c.seenIn.length }}）</h3>
    <div v-if="c.seenIn.length">
      <div v-for="s in c.seenIn" :key="s.articleId" class="list-item" @click="open(s)">
        <div style="flex: 1"><b>{{ s.title }}</b><div class="snippet" v-html="snippet(s)" /></div>
        <span class="muted">{{ s.occurrences }} 次 ›</span>
      </div>
    </div>
    <p v-else class="muted">还没在读过的故事里见过它。</p>
    <p v-if="c.moreInLibrary > 0" class="muted">书库里还有 {{ c.moreInLibrary }} 篇故事藏着这个字，以后会遇到的。</p>
    <div class="row center"><button @click="app.card = null">关闭</button></div>
  </Modal>
</template>
