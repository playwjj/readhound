// 字游记 — child app (Vue). Flow per article:
// 生字预热 → 读前任务 → 分段阅读 → 闯关题 → 生字小测 → 结算
import "@shared/styles.css";
import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router.js";
import Btn from "@shared/Btn.vue";

createApp(App).use(router).component("Btn", Btn).mount("#app");

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
