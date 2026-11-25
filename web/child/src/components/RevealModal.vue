<script setup>
import { reading } from "../reading.js";
import Modal from "./Modal.vue";
const props = defineProps({ mine: Number, r: Object });
defineEmits(["close"]);
const p = reading.R.predict;
const same = props.mine === props.r.answer;
</script>

<template>
  <Modal>
    <div class="task"><div class="lbl">🔮 揭晓</div>{{ same ? "你猜中了！" : "故事走向了另一个方向" }}</div>
    <p>你猜的是：<b>{{ p.options[mine] }}</b></p>
    <p v-if="!same">实际上：<b>{{ p.options[r.answer] }}</b></p>
    <p v-if="r.explain" class="muted">{{ r.explain }}</p>
    <p v-if="!same" class="muted">猜得不一样也很好——作家常常喜欢出人意料。</p>
    <div class="row center"><button @click="$emit('close')">接着读</button></div>
  </Modal>
</template>
