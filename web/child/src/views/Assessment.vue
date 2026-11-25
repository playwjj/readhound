<!--
  Baseline test (§5 冷启动测评). Progress stays on the device after every
  answer: "今天先到这儿" is a pause, never an end, and only a finished test
  (all levels, or the stop rule) is sent — a partial one would understate
  what the child knows.
-->
<script setup>
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { api, toast } from "../lib/api.js";
import { store } from "../lib/store.js";
import { refreshHome } from "../state.js";
import Pup from "../components/Pup.vue";

const KEY = "rh_assessment";
const router = useRouter();
const view = ref({ kind: "loading" });
let answer = null; // resolves the current item / checkpoint
const ask = (v) => new Promise((resolve) => { answer = resolve; view.value = v; });

function saved() {
  const v = store.get(KEY);
  return v && v.at && Date.now() - v.at < 14 * 86400000 ? v : null;
}

async function run() {
  const s = saved();
  const seed = s?.seed || Math.floor(Math.random() * 100000);
  const results = s?.results || [];
  const save = (level) => store.set(KEY, { seed, level, results, at: Date.now() });
  try {
    for (let level = s?.level || 0, levels = level + 1; level < levels; level++) {
      const L = await api("GET", `/api/assessment/level/${level}?seed=${seed}`);
      levels = L.levels;
      const mine = results.filter((r) => r.level === level);
      const byChar = new Map(L.items.map((it) => [it.char, it]));
      let right = mine.filter((r) => r.choice != null && r.choice === byChar.get(r.char)?.options[byChar.get(r.char).a]).length;
      for (let i = mine.length; i < L.items.length; i++) {
        const it = L.items[i];
        const choice = await ask({ kind: "item", it, level, i, total: L.items.length });
        if (choice === "STOP") {
          save(level);
          toast("记下了，下次打开从这里接着测", 2800);
          return router.replace("/");
        }
        results.push({ level, char: it.char, choice });
        save(level);
        if (choice != null && choice === it.options[it.a]) right++;
      }
      // stop at the first level where fewer than half were right (§5: 测到连续错一档为止)
      if (right / L.items.length < 0.5) break;
      if (level < levels - 1) {
        save(level + 1);
        if (!(await ask({ kind: "checkpoint", level }))) {
          toast(`记下了，下次打开从第 ${level + 2} 关接着测`, 2800);
          return router.replace("/");
        }
      }
    }
    const r = await api("POST", "/api/assessment/finish", { results });
    store.set(KEY, null);
    view.value = { kind: "done", r };
  } catch (e) {
    if (e.message === "login") return;
    view.value = { kind: "error", msg: e.offline ? "测评需要联网。连上网再来，已经答过的题都记着。" : e.message };
  }
}
onMounted(run);
</script>

<template>
  <p v-if="view.kind === 'loading'" class="center muted" style="margin-top: 20vh">准备题目……</p>

  <div v-else-if="view.kind === 'item'" :key="view.it.char" class="card warm-card">
    <div class="muted">第 {{ view.level + 1 }} 关 · {{ view.i + 1 }}/{{ view.total }}</div>
    <div class="big">{{ view.it.char }}</div>
    <div class="opts py" style="margin-top: 14px">
      <button v-for="o in view.it.options" :key="o" @click="answer(o)">{{ o }}</button>
      <button class="soft" style="font-size: 20px" @click="answer(null)">不认识</button>
    </div>
    <div class="row center" style="margin-top: 18px">
      <button class="ghost small" @click="answer('STOP')">今天先到这儿，下次接着测</button>
    </div>
  </div>

  <div v-else-if="view.kind === 'checkpoint'" class="card center" style="padding: 30px">
    <h2>第 {{ view.level + 1 }} 关完成！</h2>
    <p>下一关的字会难一点点。</p>
    <div class="row center">
      <button @click="answer(true)">继续</button>
      <button class="ghost" @click="answer(false)">休息一下，下次接着测</button>
    </div>
  </div>

  <div v-else-if="view.kind === 'done'" class="card center" style="padding: 30px 22px">
    <Pup stage="young" />
    <h2>测完啦！</h2>
    <p style="font-size: 22px">小猎犬估计你已经认识大约 <b>{{ view.r.estimate }}</b> 个字。</p>
    <p class="muted">差不多到了课本{{ view.r.reached }}的水平。接下来的故事会照着你认识的字来挑：每篇只有几个新朋友，一个一个驯服它们。</p>
    <Btn class="big" :action="async () => { await refreshHome(); router.replace('/'); }">去看今天的故事</Btn>
  </div>

  <div v-else class="card center" style="padding: 28px 20px">
    <div style="font-size: 48px">📶</div>
    <p style="font-size: 20px">{{ view.msg }}</p>
    <div class="row center">
      <button @click="run">再试一次</button>
      <button class="ghost" @click="router.replace('/')">回家</button>
    </div>
  </div>
</template>
