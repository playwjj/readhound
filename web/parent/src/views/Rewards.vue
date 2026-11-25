<script setup>
import { ref } from "vue";
import { api, toast, attempt } from "../api.js";

const loadLedger = () => api("GET", "/api/parent/ledger");
const [l0, s0] = await Promise.all([loadLedger(), api("GET", "/api/parent/settings")]);
const d = ref(l0);
const rules = ref((s0.rewards || []).map((r) => ({ ...r })));

async function redeem(r, i) {
  if (!confirm(`确认兑换「${r.item}」，扣 ${r.bones} 骨头？`)) return;
  await attempt(async () => {
    await api("POST", "/api/parent/redeem", { index: i });
    toast("已兑换");
    d.value = await loadLedger();
  });
}
async function saveRules() {
  const rewards = rules.value.map((r) => ({ bones: Number(r.bones), item: String(r.item).trim() })).filter((r) => r.item && r.bones > 0);
  await attempt(async () => {
    await api("PUT", "/api/parent/settings", { rewards });
    toast("已保存");
    d.value = await loadLedger();
  });
}
</script>

<template>
  <div class="grid2">
    <div class="card">
      <h2>骨头余额：{{ d.balance }} 🦴</h2>
      <h3>兑换</h3>
      <div v-for="(r, i) in d.rewards" :key="i" class="row" style="margin-bottom: 8px">
        <span style="flex: 1">{{ r.item }}</span><b>{{ r.bones }} 🦴</b>
        <Btn class="small" :disabled="d.balance < r.bones" :action="() => redeem(r, i)">兑换</Btn>
      </div>
      <h3>兑换规则（家长定）</h3>
      <div v-for="(r, i) in rules" :key="i" class="row" style="margin-bottom: 8px">
        <input v-model="r.bones" type="number" style="width: 110px" />
        <input v-model="r.item" placeholder="奖励内容" style="flex: 1; width: auto" />
        <button class="ghost small" @click="rules.splice(i, 1)">删除</button>
      </div>
      <div class="row">
        <button class="ghost small" @click="rules.push({ bones: 50, item: '' })">+ 添加一条</button>
        <span class="spacer" />
        <Btn class="small" :action="saveRules">保存规则</Btn>
      </div>
    </div>
    <div class="card">
      <h2>流水</h2>
      <table>
        <tr v-for="(e, i) in d.entries" :key="i">
          <td>{{ e.at.slice(0, 16) }}</td><td>{{ e.reason }}</td>
          <td :style="`color:${e.amount < 0 ? 'var(--accent)' : 'var(--good)'}`">{{ e.amount > 0 ? `+${e.amount}` : e.amount }}</td>
        </tr>
      </table>
    </div>
  </div>
</template>
