<script setup>
import { ref } from "vue";
import { net } from "@shared/ui.js";
import { auth } from "../api.js";

const pin = ref("");
const err = ref("");
async function submit() {
  err.value = "";
  const res = await net("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin: pin.value }) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) return (err.value = d.error || "登录失败");
  if (d.role !== "parent") return (err.value = "这是孩子的密码，请输入家长密码");
  auth.ok = true;
}
</script>

<template>
  <form class="card" style="max-width: 380px; margin: 12vh auto" @submit.prevent="submit">
    <h2>家长入口</h2>
    <input v-model="pin" type="password" inputmode="numeric" placeholder="家长密码" autofocus />
    <div class="err">{{ err }}</div>
    <Btn :action="submit" style="margin-top: 10px; width: 100%">进入</Btn>
  </form>
</template>
