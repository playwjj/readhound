<!--
  Shell: PIN pad when signed out, the page otherwise; the character popover,
  the archive card and the rest page float above every page.
-->
<script setup>
import { watch, watchEffect } from "vue";
import { useRoute } from "vue-router";
import { auth } from "./lib/api.js";
import { app } from "./state.js";
import Login from "./components/Login.vue";
import CharPopover from "./components/CharPopover.vue";
import CharCard from "./components/CharCard.vue";
import RestOverlay from "./components/RestOverlay.vue";

const route = useRoute();
// landscape: home-type pages use two columns, reading stays narrow
watchEffect(() => document.getElementById("app").classList.toggle("wide", !!(route.meta.wide || app.wide)));
watch(() => route.fullPath, () => {
  app.pop = null;
  app.card = null;
  app.wide = false;
});
</script>

<template>
  <Login v-if="!auth.ok" />
  <RouterView v-else v-slot="{ Component }">
    <div :key="route.path" class="page"><component :is="Component" /></div>
  </RouterView>
  <CharPopover />
  <CharCard />
  <RestOverlay />
</template>
