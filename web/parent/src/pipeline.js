// "立即处理队列": step the ingest pipeline from the browser, reporting progress.
import { ref } from "vue";
import { api, toast } from "./api.js";

export function usePipeline(onDone) {
  const progress = ref("");
  async function run() {
    try {
      for (let i = 0; i < 200; i++) {
        const r = await api("POST", "/api/parent/pipeline/step");
        progress.value = `处理中…（剩 ${r.pending}）${r.log ? " " + r.log : ""}`;
        if (r.paused) { toast(r.log.replace(/^⏸\s*/, ""), 4000); break; }
        if (!r.pending) break;
      }
    } catch (e) {
      if (e.message !== "login") toast(e.message);
    }
    progress.value = "";
    await onDone?.();
  }
  return { progress, run };
}
