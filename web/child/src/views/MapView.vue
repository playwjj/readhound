<script setup>
import { app } from "../state.js";
import PageHead from "../components/PageHead.vue";

const REGIONS = ["拼音草原", "汉字森林", "成语山谷", "神话之河", "故事城堡", "科学港湾", "诗词云岛", "智慧高塔"];
const lit = (r) => Math.max(0, Math.min(app.home.map.perRegion, app.home.completed - r * app.home.map.perRegion));
</script>

<template>
  <PageHead title="闯关地图" />
  <div v-if="app.home" class="duo">
    <div v-for="(name, r) in REGIONS" :key="name" class="card region" :class="{ locked: r > app.home.map.regionIndex }">
      <h3>{{ r > app.home.map.regionIndex ? "🔒 " : r < app.home.map.regionIndex ? "✅ " : "📍 " }}{{ name }}</h3>
      <div class="map-strip">
        <template v-for="i in app.home.map.perRegion" :key="i">
          <div v-if="i > 1" class="path" :class="{ lit: i - 1 < lit(r) }" />
          <div class="node" :class="{ lit: i - 1 < lit(r), here: r === app.home.map.regionIndex && i - 1 === app.home.map.node }">{{ i - 1 < lit(r) ? "★" : "" }}</div>
        </template>
      </div>
    </div>
  </div>
</template>
