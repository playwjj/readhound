// Pages have their own address, so the iPad back gesture works everywhere:
// back from any page lands on home (leaving a reading saves it first).
// All pages are in the main bundle: reading must work offline.
import { createRouter, createWebHashHistory } from "vue-router";
import { clock } from "./lib/clock.js";
import Home from "./views/Home.vue";
import Reading from "./views/Reading.vue";
import Assessment from "./views/Assessment.vue";
import Collection from "./views/Collection.vue";
import MapView from "./views/MapView.vue";
import Skills from "./views/Skills.vue";
import Reread from "./views/Reread.vue";

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", component: Home, meta: { wide: true } },
    { path: "/read", component: Reading },
    { path: "/assessment", component: Assessment },
    { path: "/collection", component: Collection, meta: { wide: true } },
    { path: "/map", component: MapView, meta: { wide: true } },
    { path: "/skills", component: Skills, meta: { wide: true } },
    { path: "/reread/:id(\\d+)", component: Reread, props: (r) => ({ id: Number(r.params.id), focus: r.query.c || "" }) },
    { path: "/:rest(.*)", redirect: "/" },
  ],
  scrollBehavior: () => ({ top: 0 }),
});

// the rest page cannot be skipped, not even with the back gesture
router.beforeEach(() => !clock.resting);
