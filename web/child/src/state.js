// App-wide state: today's home (drawn at once from the device copy, refreshed
// from the server), the character popover / archive card, the reading session.
import { reactive } from "vue";
import { api } from "./lib/api.js";
import { store, today, sendPending } from "./lib/store.js";
import { setEye } from "./lib/clock.js";

const saved = store.get("rh_home");
export const app = reactive({
  home: saved && saved.today === today() ? saved : null,
  homeError: null, // "offline" | message, when there is no home to show
  pop: null, // { ch, py } — the character popover
  card: null, // a character for the archive card
  wide: false, // a reading screen that wants two columns (the celebration)
});
if (app.home) setEye(app.home.eye);

let inflight = null;
/** Refresh the home from the server (one request at a time). */
export function refreshHome() {
  if (!inflight) {
    inflight = (async () => {
      try {
        app.home = await api("GET", "/api/home");
        app.homeError = null;
        store.set("rh_home", app.home);
        setEye(app.home.eye);
        sendPending();
      } catch (e) {
        if (e.message !== "login") app.homeError = e.offline ? "offline" : e.message;
      } finally {
        inflight = null;
      }
    })();
  }
  return inflight;
}
