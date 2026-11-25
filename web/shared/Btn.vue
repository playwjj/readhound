<!--
  A button whose action may be async. While it runs, the button is marked busy
  (a spinner shows while a request is in flight) and repeat taps are ignored.
  An answer group (.opts) is locked as a whole: tapping B while A is being
  judged must not count as a second attempt. Sound-only buttons use a plain
  <button> so a second tap restarts the sound.
-->
<script setup>
import { ref } from "vue";
const props = defineProps({ action: { type: Function, required: true } });
const busy = ref(false);
const el = ref(null);
async function run(e) {
  const scope = el.value.closest(".opts") || el.value;
  if (scope.dataset.busy) return;
  scope.dataset.busy = "1";
  busy.value = true;
  try {
    await props.action(e);
  } finally {
    delete scope.dataset.busy;
    busy.value = false;
  }
}
</script>

<template>
  <button ref="el" type="button" :class="{ busy }" @click="run"><slot /></button>
</template>
