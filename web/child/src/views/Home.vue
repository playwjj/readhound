<!--
  Home: drawn at once from the device copy of today's home, refreshed from the
  server behind it. Before the baseline test, home is the test's start page.
-->
<script setup>
import { computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { app, refreshHome } from "../state.js";
import { prepare } from "../reading.js";
import { cachedSession, store } from "../lib/store.js";
import Pup from "../components/Pup.vue";

const router = useRouter();
const H = computed(() => app.home);
onMounted(refreshHome);

async function start(extra) {
  if (await prepare(extra)) router.push({ path: "/read", query: extra ? { extra: 1 } : {} });
}
const offlineCopy = computed(() => app.homeError === "offline" && cachedSession(false));

const greeting = computed(() => {
  const h = H.value, name = h.childName || "小读者";
  if (h.todayDone) return `${name}，今天的阅读完成啦！小猎犬为你骄傲。`;
  if (h.session && h.session.level < 2) return `${name}，接着读上次的故事吧！`;
  if (h.streak > 0) return null; // with the streak in bold, below
  return `${name}，小猎犬闻到了一个新故事的味道……`;
});

// baseline test progress paused on this device
const assess = computed(() => {
  const v = store.get("rh_assessment");
  return v && v.at && Date.now() - v.at < 14 * 86400000 ? v : null;
});
function restartTest() {
  store.set("rh_assessment", null);
  router.push("/assessment");
}
</script>

<template>
  <!-- nothing to show yet -->
  <template v-if="!H">
    <div v-if="app.homeError" class="card center">
      <p>{{ app.homeError === "offline" ? "现在没有网络。" : "网络不太顺，检查一下再打开。" }}</p>
      <p v-if="offlineCopy" class="muted">今天的《{{ offlineCopy.article.title }}》已经存在平板里，可以先读，进度联网后会同步。</p>
      <div class="row center">
        <Btn v-if="offlineCopy" class="big" :action="() => start(false)">离线接着读</Btn>
        <Btn :class="offlineCopy ? 'ghost' : ''" :action="refreshHome">再试一次</Btn>
      </div>
    </div>
    <p v-else class="center muted" style="margin-top: 30vh">小猎犬正在赶来……</p>
  </template>

  <!-- baseline test (§5 冷启动测评) -->
  <div v-else-if="H.needAssessment" class="card center" style="padding: 30px 22px">
    <Pup stage="pup" />
    <h2>{{ assess?.results?.length ? "接着上次的找拼音游戏吧！" : "小猎犬想先认识你！" }}</h2>
    <p v-if="assess?.results?.length">上次做到第 {{ assess.level + 1 }} 关，已经答了 {{ assess.results.length }} 个字，从停下的地方接着来。</p>
    <p v-else>我们来玩一个找拼音的游戏：每次出现一个字，点出它的读音。</p>
    <p class="muted">不认识的字，就点“不认识”，一点也不丢人——这样小猎犬才知道给你准备什么故事。大约 10 分钟，可以分几次做完。</p>
    <div class="row center">
      <button class="big" @click="router.push('/assessment')">{{ assess?.results?.length ? "接着测" : "开始游戏" }}</button>
      <button v-if="assess?.results?.length" class="ghost small" @click="restartTest">从头开始</button>
    </div>
  </div>

  <template v-else>
    <div class="topbar">
      <h1>字游记</h1>
      <div class="spacer" />
      <span class="chip" title="连续天数">🔥 {{ H.streak }}<small v-if="H.freezes" class="muted" title="补签卡"> ❄{{ H.freezes }}</small></span>
      <span class="chip" title="骨头">🦴 {{ H.bones }}</span>
    </div>
    <div class="home-grid">
      <div>
        <div class="card hero">
          <Pup :stage="H.puppy.key" :acc="H.accessories" :size="132" />
          <div>
            <div class="say">
              <template v-if="greeting">{{ greeting }}</template>
              <template v-else>{{ H.childName || "小读者" }}，已经连续读了 <b>{{ H.streak }}</b> 天，今天继续！</template>
            </div>
            <div class="muted" style="font-size: 15px; margin-top: 6px">
              小猎犬等级：{{ H.puppy.name }}{{ H.puppy.next ? `（再读 ${H.puppy.next.need} 篇变成${H.puppy.next.name}）` : "" }}
            </div>
          </div>
        </div>
        <div class="card today">
          <template v-if="!H.article">
            <div class="title">今天的故事还在准备中</div>
            <p class="meta">请爸爸妈妈在家长页添加文章，晚点再来看看。</p>
          </template>
          <template v-else>
            <div v-if="H.todayDone" class="done-badge">✓ 今日已通关</div>
            <div class="muted">今日一篇</div>
            <div class="title">{{ H.article.title }}</div>
            <div class="meta">{{ [H.article.genre, `${H.article.chars} 字`, "约 12 分钟"].filter(Boolean).join(" · ") }}</div>
            <p v-if="H.eye.listenOnly" class="muted">{{ H.eye.reason === "bedtime" ? "🌙 现在是睡前时间，只能听故事哦。" : "👀 今天看屏幕够久啦，剩下的时间听故事吧。" }}</p>
            <div class="row center">
              <Btn v-if="!H.todayDone" class="big" :action="() => start(false)">{{ H.session ? "继续阅读" : "开始阅读" }}</Btn>
              <template v-else>
                <Btn class="soft" :action="() => start(false)">再看一遍</Btn>
                <Btn v-if="H.canExtra && !H.eye.listenOnly" :action="() => start(true)">再读一篇 🦴</Btn>
              </template>
            </div>
          </template>
        </div>
      </div>
      <div>
        <div class="stats">
          <div class="stat"><b>{{ H.completed }}</b><span>读完的文章</span></div>
          <div class="stat"><b>{{ H.tamedChars }}</b><span>驯服的生字</span></div>
          <div class="stat"><b>{{ H.knownChars }}</b><span>认识的字</span></div>
        </div>
        <div class="card map-card">
          <div class="row"><b>🗺 {{ H.map.region }}</b><span class="spacer" /><span class="muted">第 {{ H.map.node + 1 }} / {{ H.map.perRegion }} 站</span></div>
          <div class="map-strip">
            <template v-for="i in H.map.perRegion" :key="i">
              <div v-if="i > 1" class="path" :class="{ lit: i - 1 <= H.map.node }" />
              <div class="node" :class="{ lit: i - 1 < H.map.node, here: i - 1 === H.map.node }">{{ i - 1 < H.map.node ? "★" : i }}</div>
            </template>
          </div>
        </div>
        <div class="nav">
          <button @click="router.push('/collection')"><span class="ico">📖</span>生字图鉴</button>
          <button @click="router.push('/map')"><span class="ico">🗺</span>闯关地图</button>
          <button @click="router.push('/skills')"><span class="ico">🎒</span>技能法宝</button>
        </div>
      </div>
    </div>
    <div class="foot"><a href="/parent/">家长入口</a></div>
  </template>
</template>
