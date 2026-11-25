// The reading session: data from /api/session/start (or the device copy when
// offline), dwell time per paragraph, taps, answers, and progress flushes.
import { reactive } from "vue";
import { api, toast } from "./lib/api.js";
import { store, cacheSession, cachedSession, queueProgress } from "./lib/store.js";
import { clock, setTick } from "./lib/clock.js";
import { isPlaying, stopAudio } from "./lib/voice.js";

export const reading = reactive({ R: null });

/** Load a session (button action on home). Returns false if there is nothing to read. */
export async function prepare(extra) {
  let data;
  try {
    data = await api("POST", "/api/session/start", { extra });
    cacheSession(extra, data);
  } catch (e) {
    if (e.message === "login") return false;
    data = e.offline ? cachedSession(extra) : null;
    if (!data) {
      toast(e.offline ? "没有网络，今天的故事还没下载到平板上" : e.message);
      return false;
    }
    toast("离线阅读中：进度会在联网后同步", 3200);
    // pick up progress made offline earlier today
    const pending = (store.get("rh_pending") || {})[data.session.id];
    if (pending) {
      data.session.lastParagraph = Math.max(data.session.lastParagraph, pending.lastParagraph || 0);
      data.session.dwell = pending.dwell || data.session.dwell;
      data.session.activeMs = Math.max(data.session.activeMs, pending.activeMs || 0);
    }
  }
  document.documentElement.style.setProperty("--read-size", `${data.settings.fontSize}px`);
  const answered = new Map();
  for (const a of data.session.answered) {
    const cur = answered.get(a.questionId) || { attempts: 0, correct: false };
    cur.attempts = Math.max(cur.attempts, a.attempt);
    cur.correct = cur.correct || a.correct;
    cur.choice = a.choice;
    answered.set(a.questionId, cur);
  }
  reading.R = {
    ...data,
    extra,
    idx: Math.min(data.session.lastParagraph, data.article.paragraphs.length - 1),
    dwell: data.article.paragraphs.map((_, i) => data.session.dwell[i] || 0),
    activeMs: data.session.activeMs || 0,
    taps: [],
    tapped: new Set(),
    answered,
    quiz: new Map(data.session.quizDone.map((q) => [q.char, q])),
    mode: store.get("rh_mode") || "self",
    stage: "warmup",
    newSet: new Set(data.newChars.map((c) => c.char)),
    reviewSet: new Set(data.reviewChars.map((c) => c.char)),
    glossOf: new Map([...data.newChars, ...data.reviewChars].map((c) => [c.char, c])),
  };
  return true;
}

/** A question is settled once right, or after two tries. */
export const settled = (R, id) => R.answered.get(id)?.correct || (R.answered.get(id)?.attempts || 0) >= 2;

/** Record an answer reply in the session state. */
export function noteAnswer(R, id, r) {
  const st = R.answered.get(id) || { attempts: 0, correct: false };
  st.attempts = r.attempt || st.attempts + 1;
  st.correct = st.correct || r.correct;
  R.answered.set(id, st);
}

/** Accrue reading time to the paragraph on screen (only while the child is active). */
function readingTick(dt, now) {
  const R = reading.R;
  if (!R || R.stage !== "read") return;
  if (now - clock.lastTouch > 90000 && !isPlaying()) return;
  R.dwell[R.idx] = (R.dwell[R.idx] || 0) + dt;
  R.activeMs += dt;
}

export async function flush() {
  const R = reading.R;
  if (!R?.session) return;
  const body = { lastParagraph: R.idx, dwell: [...R.dwell], activeMs: R.activeMs, taps: R.taps.splice(0), screenMsDelta: clock.screenDelta };
  clock.screenDelta = 0;
  // keep the on-device copy at the current position, so an offline reopen resumes here
  const key = `rh_session_${R.session.daily ? "daily" : "extra"}`;
  const c = store.get(key);
  if (c && c.data.session.id === R.session.id) {
    Object.assign(c.data.session, { lastParagraph: Math.max(c.data.session.lastParagraph, R.idx), dwell: body.dwell, activeMs: R.activeMs });
    store.set(key, c);
  }
  try {
    const r = await api("POST", `/api/session/${R.session.id}/progress`, body);
    if (r.eye) R.eye = r.eye;
  } catch (e) {
    // keep it (taps and screen time included) until the network is back
    if (e.offline) queueProgress(R.session.id, body);
  }
}

let flushTimer = null;
const onHide = () => { if (document.visibilityState === "hidden") { flush(); stopAudio(); } };
export function begin() {
  setTick(readingTick);
  clearInterval(flushTimer);
  flushTimer = setInterval(() => reading.R && flush(), 15000);
  document.addEventListener("visibilitychange", onHide);
}
/** Leaving the reading (home button, back gesture): save and stop everything. */
export function leave() {
  stopAudio();
  flush();
  clearInterval(flushTimer);
  setTick(null);
  document.removeEventListener("visibilitychange", onHide);
  reading.R = null;
}
