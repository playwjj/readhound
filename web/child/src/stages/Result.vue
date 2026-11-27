<!--
  6. 结算. Completed: rewards, chest, retell. Not yet: the one way through —
  look back and answer again, read again slowly, or meet the missed
  characters once more. Reports {action} to the reading flow.
-->
<script setup>
import { ref, computed, onMounted } from "vue";
import { reading, progressAt } from "../reading.js";
import { app } from "../state.js";
import { confetti } from "../lib/fx.js";
import PageHead from "../components/PageHead.vue";
import Pup from "../components/Pup.vue";
import LookBackModal from "../components/LookBackModal.vue";
import WholeTextModal from "../components/WholeTextModal.vue";

const props = defineProps({ res: Object, already: Boolean });
const emit = defineEmits(["done"]);
const R = reading.R;
const done = props.already || props.res?.alreadyCompleted;
const v = props.res?.verdict;
const rw = props.res?.rewards;
const chestOpen = ref(false);
const whole = ref(false);
const look = ref(null);
const canRetell = computed(() => R.retell && R.retell.triesLeft > 0);

// not yet completed: which way through, in the order the gates are checked
const way = computed(() => {
  if (done || v.completed) return null;
  const g = v.gates || {};
  const canRetryQ = v.retryQuestions.filter((id) => (R.answered.get(id)?.attempts || 0) < R.maxAttempts);
  const missedChars = R.charQuiz.filter((c) => R.quiz.get(c.char) && !R.quiz.get(c.char).correct && !R.quiz.get(c.char).retryOk).map((c) => c.char);
  if (!g.questions?.ok && canRetryQ.length) {
    const qs = R.questions.concat(R.guess ? [{ id: R.guess.id, evidence: R.guess.paragraph }] : []);
    const evid = [...new Set(qs.filter((q) => canRetryQ.includes(q.id)).map((q) => q.evidence).filter((x) => x != null))];
    return { kind: "retry", ids: canRetryQ, evidence: evid[0] ?? null };
  }
  if (g.reading && !g.reading.ok) return { kind: "reread" };
  if (g.chars && !g.chars.ok && missedChars.length) return { kind: "remeet", chars: missedChars };
  return { kind: "none" };
});
// the three checks, each with how far along it is
const checks = computed(() => {
  const g = v?.gates;
  if (!g) return [];
  const out = [{ ok: g.questions.ok, text: `闯关题：找到答案 ${g.questions.found}/${g.questions.total} 道` }];
  out.push({ ok: g.reading.ok, text: g.reading.ok ? "认真读完了全文" : g.reading.unread ? `还有 ${g.reading.unread} 段读得太快` : "读得有点快" });
  if (g.chars.total) out.push({ ok: g.chars.ok, text: `生字小测：对了 ${g.chars.right}/${g.chars.total} 个（要对 ${g.chars.need} 个）` });
  return out;
});
const TIER_NOTE = {
  recovered: "第一次没答对的，你回去都找到了答案！",
  found: "找回答案也算通关！下次第一次就答对，骨头会更多哦。",
  effort: "今天认认真真读完了，也算数！没答对的题，小猎犬帮你记下来了。",
};
function retry() {
  if (way.value.evidence != null) look.value = way.value.evidence;
  else emit("done", { action: "retry", ids: way.value.ids });
}
onMounted(() => { if (!done && v.completed) confetti(); });
</script>

<template>
  <!-- already completed earlier -->
  <template v-if="done">
    <PageHead :title="R.article.title" :pct="1" />
    <div class="card celebrate">
      <h2>这篇已经通关啦 ✓</h2>
      <p>想再读一遍也可以，不过骨头只发一次哦。</p>
      <div class="row center">
        <button class="soft" @click="whole = true">📄 再读一遍</button>
        <button v-if="canRetell" class="soft" @click="emit('done', { action: 'retell' })">🎤 讲给小猎犬听 +3🦴</button>
        <button @click="emit('done', { action: 'home' })">回家</button>
      </div>
    </div>
  </template>

  <!-- almost -->
  <template v-else-if="!v.completed">
    <PageHead :title="R.article.title" :pct="progressAt('chars', 0.95)" />
    <div class="card celebrate">
      <Pup :stage="app.home?.puppy.key" :acc="app.home?.accessories" :size="120" />
      <h2>差一点点就通关了！</h2>
      <p style="font-size: 20px">{{ v.hint || "再读一读，答案就藏在文章里。" }}</p>
      <ul class="checks">
        <li v-for="c in checks" :key="c.text" :class="{ ok: c.ok }">{{ c.ok ? "✓" : "○" }} {{ c.text }}</li>
      </ul>
      <p v-if="way.kind === 'none'" class="muted">今天就到这儿吧，明天再来，这篇还在等你。</p>
      <div class="row center">
        <button v-if="way.kind === 'retry'" class="big" @click="retry">回去看看，再答一次</button>
        <button v-else-if="way.kind === 'reread'" class="big" @click="emit('done', { action: 'reread' })">慢慢再读一遍</button>
        <button v-else-if="way.kind === 'remeet'" class="big" @click="emit('done', { action: 'remeet', chars: way.chars })">再和生字见一面</button>
        <button class="ghost" @click="emit('done', { action: 'home' })">今天先到这儿</button>
      </div>
    </div>
    <LookBackModal v-if="look != null" :i="look" @close="emit('done', { action: 'retry', ids: way.ids })" />
  </template>

  <!-- completed now -->
  <template v-else>
    <PageHead :title="R.article.title" :pct="1" />
    <div class="card celebrate split">
      <div>
        <Pup :stage="rw.puppy.key" :acc="app.home?.accessories || []" />
        <h2>{{ R.session.daily ? "今日阅读完成！" : "又读完一篇！" }}</h2>
        <p v-if="TIER_NOTE[v.tier]" class="muted" style="font-size: 18px">{{ TIER_NOTE[v.tier] }}</p>
        <p v-if="rw.puppyGrew" class="surprise">🎉 小猎犬长大了，变成了{{ rw.puppy.name }}！</p>
        <div style="text-align: left; margin: 16px 0">
          <div v-for="g in rw.bones" :key="g.reason" class="gain"><span>{{ g.reason }}</span><b>+{{ g.amount }} 🦴</b></div>
          <div class="gain"><span>骨头总数</span><b>{{ rw.balance }}</b></div>
        </div>
      </div>
      <div>
        <p v-if="R.session.daily">🔥 连续阅读 <b>{{ rw.streak }}</b> 天{{ rw.freezeEarned ? "，还得到一张补签卡 ❄" : "" }}</p>
        <p v-if="rw.map.firstVisit" class="surprise">🗺 第一次来到{{ rw.map.icon }} {{ rw.map.region }}！</p>
        <p v-else class="muted">🗺 {{ rw.map.icon }} {{ rw.map.region }}点亮了第 {{ Math.min(rw.map.count, 10) }} 颗星</p>
        <div v-if="rw.medals.length"><span v-for="m in rw.medals" :key="m.title" class="medal">🏅 {{ m.title }}</span></div>
        <div v-if="rw.chest">
          <template v-if="!chestOpen">
            <div class="muted">点开惊喜宝箱</div>
            <button class="chest" @click="chestOpen = true">🎁</button>
          </template>
          <div v-else class="surprise">{{ rw.chest.kind === "accessory" ? "🎁 " : rw.chest.kind === "fact" ? "💡 冷知识：" : "😄 " }}{{ rw.chest.text }}</div>
        </div>
        <div class="row center" style="margin-top: 16px">
          <button v-if="canRetell" class="soft" @click="emit('done', { action: 'retell' })">🎤 讲给小猎犬听 +3🦴</button>
          <button class="big" @click="emit('done', { action: 'home' })">回家</button>
        </div>
      </div>
    </div>
  </template>
  <WholeTextModal v-if="whole" @close="whole = false" />
</template>
