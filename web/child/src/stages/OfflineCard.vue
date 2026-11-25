<script setup>
defineProps({ msg: String });
defineEmits(["done"]);
</script>

<template>
  <div class="card center" style="padding: 28px 20px">
    <div style="font-size: 48px">📶</div>
    <p style="font-size: 20px">{{ msg }}</p>
    <div class="row center"><button @click="$emit('done')">连上了，再试一次</button></div>
  </div>
</template>
