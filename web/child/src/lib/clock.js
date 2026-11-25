// Eye care (§15): screen time, the rest page, night theme.
import { reactive } from "vue";
import { stopAudio } from "./voice.js";

export const clock = reactive({
  screenDelta: 0, // ms since last flush (all foreground time counts toward the daily limit)
  sinceRest: 0, // ms of screen time since the last rest page
  lastTick: Date.now(),
  lastTouch: Date.now(),
  sessionMin: 15,
  restMin: 2,
  resting: false,
});
/** Called every second while visible and not resting (the reading accrues dwell time). */
let onTick = null;
export const setTick = (fn) => (onTick = fn);

["pointerdown", "keydown", "scroll", "touchstart"].forEach((ev) => addEventListener(ev, () => (clock.lastTouch = Date.now()), { passive: true }));
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(now - clock.lastTick, 5000);
  clock.lastTick = now;
  if (document.visibilityState !== "visible" || clock.resting) return;
  clock.screenDelta += dt;
  clock.sinceRest += dt;
  if (onTick) onTick(dt, now);
  if (clock.sessionMin > 0 && clock.sinceRest >= clock.sessionMin * 60000) startRest();
}, 1000);

export function setEye(eye) {
  if (!eye) return;
  clock.sessionMin = eye.sessionMin;
  clock.restMin = eye.restMin;
}
export function startRest() {
  if (clock.resting) return;
  stopAudio();
  clock.resting = true;
}
export function endRest() {
  clock.resting = false;
  clock.sinceRest = 0;
}

// night theme: low light after 19:30 until 6:30
function applyTheme() {
  const hr = new Date().getHours() + new Date().getMinutes() / 60;
  if (hr >= 19.5 || hr < 6.5) document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
}
applyTheme();
setInterval(applyTheme, 5 * 60000);
