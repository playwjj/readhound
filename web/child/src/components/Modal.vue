<!-- A bottom sheet over the page. It belongs to the page: leaving the page closes it. -->
<script setup>
defineProps({ dismissable: { type: Boolean, default: false } });
const emit = defineEmits(["close"]);
</script>

<template>
  <Teleport to="body">
    <div class="modal" @click.self="dismissable && emit('close')">
      <div class="sheet"><slot /></div>
    </div>
  </Teleport>
</template>
