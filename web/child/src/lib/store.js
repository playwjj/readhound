// On-device copies. Today's opened article is kept so reading continues
// without network; progress waits in a queue and is sent when the network
// is back. localStorage can be unavailable (private mode): everything still
// works online.
import { api, toast } from "./api.js";

export const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export const store = {
  get(k) {
    try { return JSON.parse(localStorage.getItem(k)); } catch { return null; }
  },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode / full */ }
  },
};

export function cacheSession(extra, data) {
  store.set(`rh_session_${extra ? "extra" : "daily"}`, { day: today(), data });
}
export function cachedSession(extra) {
  const c = store.get(`rh_session_${extra ? "extra" : "daily"}`);
  return c && c.day === today() ? c.data : null;
}

/** Merge a progress body into the pending queue (one entry per session; dwell is cumulative). */
export function queueProgress(sessionId, body) {
  const q = store.get("rh_pending") || {};
  const prev = q[sessionId];
  if (prev) {
    body.taps = [...(prev.taps || []), ...(body.taps || [])];
    body.screenMsDelta = (prev.screenMsDelta || 0) + (body.screenMsDelta || 0);
    body.lastParagraph = Math.max(prev.lastParagraph || 0, body.lastParagraph || 0);
  }
  q[sessionId] = body;
  store.set("rh_pending", q);
}
export async function sendPending() {
  const q = store.get("rh_pending") || {};
  for (const [id, body] of Object.entries(q)) {
    try {
      await api("POST", `/api/session/${id}/progress`, body);
      delete q[id];
    } catch (e) {
      if (!e.offline) delete q[id]; // a server-side refusal will not get better by retrying
    }
  }
  store.set("rh_pending", q);
}
addEventListener("online", () => { sendPending(); toast("网络回来了，进度已同步"); });
