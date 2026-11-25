// Shared UI layer for the child app and the parent console.
//
// One rule: every tap answers at once.
// - h(): an onclick that returns a promise marks its button busy until the
//   promise settles. Repeat taps are ignored, so an answer cannot be sent twice,
//   and a spinner appears while a request is in flight.
// - net(): wraps a fetch. While any request runs longer than 150 ms, a thin bar
//   moves along the top of the screen.

// ---------------------------------------------------------------- network activity
let inflight = 0;
let barTimer = null;
let bar = null;
function netBar() {
  if (!bar) {
    bar = document.createElement("div");
    bar.className = "netbar";
    document.body.append(bar);
  }
  return bar;
}
function netStart() {
  if (inflight++ === 0) {
    clearTimeout(barTimer);
    barTimer = setTimeout(() => { netBar().classList.add("on"); document.body.classList.add("net"); }, 150);
  }
}
function netEnd() {
  if (--inflight <= 0) {
    inflight = 0;
    clearTimeout(barTimer);
    if (bar) bar.classList.remove("on");
    document.body.classList.remove("net");
  }
}
/** fetch() with the activity bar. */
export async function net(path, init) {
  netStart();
  try {
    return await fetch(path, init);
  } finally {
    netEnd();
  }
}

// ---------------------------------------------------------------- elements
// An answer group (.opts) is locked as a whole: tapping B while A is being
// judged must not count as a second attempt. Handlers that only play sound
// return nothing (`() => void speak(x)`), so a second tap restarts the sound.
function guarded(el, fn) {
  return (e) => {
    const scope = el.closest(".opts") || el;
    if (scope.dataset.busy) return;
    const r = fn(e);
    if (r && typeof r.then === "function") {
      scope.dataset.busy = "1";
      el.classList.add("busy");
      r.finally(() => {
        delete scope.dataset.busy;
        el.classList.remove("busy");
      }).catch(() => {});
    }
    return r;
  };
}

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "onclick") el.addEventListener("click", guarded(el, v));
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v;
    else if (k === "class") el.className = v;
    else if (k === "style") el.style.cssText = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}

export function toast(msg, ms = 2400) {
  const t = h("div", { class: "toast" }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}

// iOS Safari shows :active (the press-down look) only when the page listens to touches
document.addEventListener("touchstart", () => {}, { passive: true });
