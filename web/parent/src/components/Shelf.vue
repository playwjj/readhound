<!--
  公版名篇书架: public-domain texts checked for a grade-4 reader. One tap
  queues a text; a book is fetched chapter by chapter (one request each),
  long chapters become parts read in order.
-->
<script setup>
import { ref, reactive } from "vue";
import { api, toast } from "../api.js";
import { GENRES } from "../labels.js";

const d = ref(await api("GET", "/api/parent/shelf"));
const progress = reactive({});
const FIT = { good: ["ready", "现在合适"], ok: ["queued", "稍难"], hard: ["rejected", "先放一放"] };

async function add(it) {
  let page = it.pagesDone || 0;
  let added = 0;
  try {
    while (page != null && page < it.pages) {
      progress[it.key] = `正在取第 ${page + 1}/${it.pages} ${it.pages > 1 ? "章" : "篇"}…`;
      const r = await api("POST", "/api/parent/shelf", { key: it.key, page });
      added += r.added;
      page = r.next;
    }
    toast(`《${it.title}》加入了 ${added} 篇，AI 会按每天的额度依次处理`, 4000);
  } catch (e) {
    if (e.message !== "login") toast(`${e.message}（已加入的会保留，再点一次接着取）`, 4000);
  }
  delete progress[it.key];
  d.value = await api("GET", "/api/parent/shelf");
}
</script>

<template>
  <div class="card">
    <h2>公版名篇书架</h2>
    <p class="muted">作者去世满 50 年的作品已进入公版，可以放心使用。这里挑了适合四年级的课本名家名篇，全文来自维基文库。长的章节会切成几篇，按顺序读：读完上一篇，下一篇才会出现。</p>
    <div v-for="it in d.items" :key="it.key" class="shelf-item">
      <div class="shelf-main">
        <div>
          <b>{{ it.title }}</b>
          <span class="muted"> · {{ it.author }} · {{ GENRES[it.genre] || it.genre }}</span>
          <span class="pill" :class="FIT[it.fit][0]" style="margin-left: 6px">{{ FIT[it.fit][1] }}</span>
        </div>
        <div class="muted small-note">{{ it.note }}</div>
      </div>
      <div class="shelf-act">
        <span v-if="progress[it.key]" class="muted small-note">{{ progress[it.key] }}</span>
        <template v-else-if="it.articles && it.pagesDone >= it.pages">
          <span class="muted small-note">已加入 {{ it.articles }} 篇<template v-if="it.ready">，{{ it.ready }} 篇可读</template></span>
        </template>
        <Btn v-else class="small" :class="{ soft: it.fit === 'hard' }" :action="() => add(it)">
          {{ it.pagesDone ? `接着取（${it.pagesDone}/${it.pages}）` : it.pages > 1 ? `加入（${it.pages} 章）` : "加入" }}
        </Btn>
      </div>
    </div>
  </div>
</template>

<style>
.shelf-item { display: flex; gap: 12px; align-items: center; padding: 10px 0; border-top: 1px solid var(--line); }
.shelf-main { flex: 1; min-width: 0; }
.shelf-act { flex: none; text-align: right; max-width: 40%; }
</style>
