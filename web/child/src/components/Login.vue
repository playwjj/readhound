<!-- PIN pad (the child's PIN; the parent's PIN works too). -->
<script setup>
import { ref } from "vue";
import { api, auth } from "../lib/api.js";
import { refreshHome } from "../state.js";
import Pup from "./Pup.vue";

const pin = ref("");
const err = ref("");
async function press(k) {
  err.value = "";
  if (k === "⌫") pin.value = pin.value.slice(0, -1);
  else if (k === "✓") {
    try {
      const r = await api("POST", "/api/login", { pin: pin.value });
      if (r.role === "parent" && location.search.includes("parent")) return void (location.href = "/parent/");
      auth.ok = true;
      await refreshHome();
    } catch (e) {
      if (e.message !== "login") err.value = e.message;
      pin.value = "";
    }
  } else if (pin.value.length < 8) pin.value += k;
}
</script>

<template>
  <div class="pin-wrap">
    <Pup stage="young" :size="140" />
    <h1>字游记</h1>
    <p class="muted">输入密码，小猎犬就来陪你读书</p>
    <div class="pin-dots"><i v-for="i in Math.max(4, pin.length)" :key="i" :class="{ on: i <= pin.length }" /></div>
    <div class="err">{{ err }}</div>
    <div class="pad">
      <Btn v-for="k in '123456789⌫0✓'" :key="k" :action="() => press(k)">{{ k }}</Btn>
    </div>
  </div>
</template>
