// 字游记 — parent console (Vue).
import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router.js";
import Btn from "./components/Btn.vue";

createApp(App).use(router).component("Btn", Btn).mount("#app");
