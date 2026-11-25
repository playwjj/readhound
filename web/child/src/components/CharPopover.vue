<!-- Tapped character: sound, pinyin, meaning; "where have I seen it?" opens the archive card. -->
<script setup>
import { computed, watch } from "vue";
import { app } from "../state.js";
import { reading } from "../reading.js";
import { speak } from "../lib/voice.js";

const g = computed(() => app.pop && reading.R?.glossOf.get(app.pop.ch));
watch(() => app.pop, (p) => p && speak(p.ch));
function archive() {
  app.card = app.pop.ch;
  app.pop = null;
}
</script>

<template>
  <Teleport to="body">
    <div v-if="app.pop" class="pop">
      <div class="row">
        <div class="big">{{ app.pop.ch }}</div>
        <div>
          <div class="py">{{ app.pop.py }}</div>
          <div v-if="g?.word && g.word !== app.pop.ch">{{ g.word }}</div>
          <div v-if="g?.gloss" class="muted">{{ g.gloss }}</div>
        </div>
        <div class="spacer" />
        <button class="icon soft" @click="speak(g?.word || app.pop.ch)">🔊</button>
      </div>
      <div class="row end" style="margin-top: 8px">
        <button class="ghost small" @click="archive">我在哪儿见过它？</button>
        <button class="small" @click="app.pop = null">知道了</button>
      </div>
    </div>
  </Teleport>
</template>
