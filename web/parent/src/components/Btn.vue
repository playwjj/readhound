<!--
  A button whose action may be async: while it runs the button is marked busy
  (spinner while a request is in flight) and further taps are ignored.
-->
<script setup>
import { ref } from "vue";
const props = defineProps({ action: { type: Function, required: true } });
const busy = ref(false);
async function run(e) {
  if (busy.value) return;
  busy.value = true;
  try {
    await props.action(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <button type="button" :class="{ busy }" @click="run"><slot /></button>
</template>
