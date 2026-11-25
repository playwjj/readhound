<script setup>
import { ref, reactive } from "vue";
import { api, toast, attempt } from "../api.js";

const s = ref(await api("GET", "/api/parent/settings"));
const v = s.value;
const f = reactive({
  child_name: v.child_name, interests: (v.interests || []).join("、"), pinyin: v.pinyin, font_size: v.font_size,
  target_new: v.target_new, skill_days: v.skill_days, session_min: v.session_min, rest_min: v.rest_min,
  daily_limit_min: v.daily_limit_min, audio: v.audio ? "1" : "0",
  hero_name: v.protagonist?.name || "", hero_traits: v.protagonist?.traits || "", hero_friends: v.protagonist?.friends || "",
  ai_daily_calls: v.ai_daily_calls, auto_generate: v.auto_generate ? "1" : "0", bedtime: v.bedtime, wake_time: v.wake_time,
});

async function save() {
  await attempt(async () => {
    await api("PUT", "/api/parent/settings", {
      child_name: f.child_name.trim(),
      pinyin: f.pinyin,
      font_size: Number(f.font_size),
      session_min: Number(f.session_min),
      rest_min: Number(f.rest_min),
      daily_limit_min: Number(f.daily_limit_min),
      bedtime: f.bedtime,
      wake_time: f.wake_time,
      interests: f.interests.split(/[,，、\s]+/).filter(Boolean),
      target_new: Number(f.target_new),
      skill_days: Number(f.skill_days),
      audio: f.audio === "1",
      protagonist: { name: f.hero_name.trim(), traits: f.hero_traits.trim(), friends: f.hero_friends.trim() },
      auto_generate: f.auto_generate === "1",
      ai_daily_calls: Number(f.ai_daily_calls),
    });
    toast("已保存");
  });
}
async function removeFix(word) {
  await attempt(async () => {
    await api("DELETE", "/api/parent/pinyin-fix", { word });
    s.value = await api("GET", "/api/parent/settings");
  });
}
</script>

<template>
  <div class="card">
    <div class="grid2">
      <div><label>孩子的称呼</label><input v-model="f.child_name" /></div>
      <div><label>兴趣标签</label><input v-model="f.interests" /><div class="muted small-note">如：动物、科学、冒险、搞笑、历史——选文会向这些倾斜</div></div>
      <div>
        <label>拼音标注</label>
        <select v-model="f.pinyin"><option value="all">全文标注（默认）</option><option value="new">只标生字</option><option value="off">不标（点字才显示）</option></select>
        <div class="muted small-note">拼音是拐杖：熟练后逐步调降</div>
      </div>
      <div><label>正文字号（px）</label><input v-model="f.font_size" type="number" min="16" max="40" /><div class="muted small-note">≥18，默认 22</div></div>
      <div><label>每篇目标生字数</label><input v-model="f.target_new" type="number" min="2" max="10" /><div class="muted small-note">系统会按正确率自动升降</div></div>
      <div><label>每通关几篇解锁一个技能</label><input v-model="f.skill_days" type="number" min="0" max="30" /><div class="muted small-note">0 = 所有技能立即解锁</div></div>
      <div><label>单次阅读时长（分钟）</label><input v-model="f.session_min" type="number" min="5" max="40" /><div class="muted small-note">到时进入休息页</div></div>
      <div><label>休息页锁定（分钟）</label><input v-model="f.rest_min" type="number" min="0" max="10" /></div>
      <div><label>每日看屏上限（分钟）</label><input v-model="f.daily_limit_min" type="number" min="0" max="180" /><div class="muted small-note">超过后只能听读；0 = 不限</div></div>
      <div>
        <label>预生成朗读音频</label>
        <select v-model="f.audio"><option value="1">是（需配置 TTS_MODEL，存 R2）</option><option value="0">否（用设备语音）</option></select>
        <div class="muted small-note">Workers AI 目前没有中文朗读模型，默认用 iPad 自带中文语音</div>
      </div>
      <div><label>定制故事主角名</label><input v-model="f.hero_name" :placeholder="`留空 = ${s.child_name}`" /></div>
      <div><label>主角性格与爱好</label><input v-model="f.hero_traits" placeholder="如：爱踢球，有点马虎，喜欢恐龙" /></div>
      <div><label>主角的好朋友</label><input v-model="f.hero_friends" placeholder="如：同桌乐乐、小狗豆豆" /></div>
      <div><label>每天入库最多调用 AI 次数</label><input v-model="f.ai_daily_calls" type="number" min="0" max="1000" /><div class="muted small-note">一篇文章约 5–6 次；0 = 不限。剩下的额度留给复述等孩子当天用的功能</div></div>
      <div>
        <label>书库不够时自动写故事</label>
        <select v-model="f.auto_generate"><option value="1">是（每天最多一篇）</option><option value="0">否</option></select>
        <div class="muted small-note">合适的未读文章少于 2 篇时，AI 按孩子的字表补一篇</div>
      </div>
      <div><label>就寝时间</label><input v-model="f.bedtime" type="time" /><div class="muted small-note">之后只开放听读</div></div>
      <div><label>起床时间</label><input v-model="f.wake_time" type="time" /></div>
    </div>
    <div class="row end" style="margin-top: 16px"><Btn :action="save">保存设置</Btn></div>

    <h3>拼音纠错（{{ (s.pinyin_fixes || []).length }}）</h3>
    <table v-if="(s.pinyin_fixes || []).length">
      <tr v-for="x in s.pinyin_fixes" :key="x.word">
        <td style="font-size: 20px">{{ x.word }}</td><td>{{ x.pinyin }}</td>
        <td><Btn class="ghost small" :action="() => removeFix(x.word)">删除</Btn></td>
      </tr>
    </table>
    <p v-else class="muted">还没有。在<RouterLink to="/library">书库</RouterLink>里打开文章，点读错的字即可纠正。</p>
  </div>
</template>
