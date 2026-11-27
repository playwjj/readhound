<!--
  闯关地图: each region is lit by reading its kind of story (读神话点亮神话之河);
  every region read 3+ times adds a floor to 智慧高塔.
-->
<script setup>
import { app } from "../state.js";
import PageHead from "../components/PageHead.vue";

const GENRE_HINT = {
  story: "故事和生活小文", fairy: "童话", fable: "寓言", idiom: "成语故事",
  myth: "神话传说", science: "科普文章", history: "历史故事", poem: "诗歌",
};
</script>

<template>
  <PageHead title="闯关地图" />
  <template v-if="app.home?.map?.regions">
    <div class="card tower">
      <h3>🗼 智慧高塔：{{ app.home.map.tower.floors }} / {{ app.home.map.tower.total }} 层</h3>
      <p class="lock-hint">每个地区读满 3 篇，高塔就多亮一层。</p>
    </div>
    <div class="duo">
      <div v-for="r in app.home.map.regions" :key="r.key" class="card region" :class="{ locked: !r.count }">
        <h3>{{ r.icon }} {{ r.name }}{{ r.full ? " ✅" : "" }}</h3>
        <p class="lock-hint">{{ r.count ? `读了 ${r.count} 篇${GENRE_HINT[r.key]}` : `读一篇${GENRE_HINT[r.key]}，就能点亮这里` }}</p>
        <div class="map-strip">
          <template v-for="i in app.home.map.perRegion" :key="i">
            <div v-if="i > 1" class="path" :class="{ lit: i - 1 < r.lit }" />
            <div class="node" :class="{ lit: i - 1 < r.lit }">{{ i - 1 < r.lit ? "★" : "" }}</div>
          </template>
        </div>
      </div>
    </div>
  </template>
</template>
