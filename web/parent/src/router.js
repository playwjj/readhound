import { createRouter, createWebHashHistory } from "vue-router";

export const TABS = [
  { path: "/report", label: "报告", component: () => import("./views/Report.vue") },
  { path: "/library", label: "书库", component: () => import("./views/Library.vue") },
  { path: "/add", label: "添加文章", component: () => import("./views/Add.vue") },
  { path: "/textbook", label: "课本", component: () => import("./views/Textbook.vue") },
  { path: "/chars", label: "生字", component: () => import("./views/Chars.vue") },
  { path: "/settings", label: "设置", component: () => import("./views/Settings.vue") },
  { path: "/rewards", label: "奖励", component: () => import("./views/Rewards.vue") },
  { path: "/passport", label: "阅读护照", component: () => import("./views/Passport.vue") },
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", redirect: "/report" },
    ...TABS.map(({ path, component }) => ({ path, component })),
    // an article has its own address, so the back gesture returns to the list
    { path: "/library/:id(\\d+)", component: () => import("./views/Article.vue"), props: (r) => ({ id: Number(r.params.id) }) },
    { path: "/:rest(.*)", redirect: "/report" },
  ],
  scrollBehavior: (to, from, saved) => saved || { top: 0 },
});
