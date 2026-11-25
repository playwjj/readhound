// Shared feedback layer for the child app and the parent console.
// - net(): fetch with a thin activity bar along the top of the screen while
//   any request runs longer than 150 ms (and body.net, which shows the busy
//   spinner on the button that started it: see Btn.vue).
// - toast(): a short message at the bottom.

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

export function toast(msg, ms = 2400) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}

// iOS Safari shows :active (the press-down look) only when the page listens to touches
document.addEventListener("touchstart", () => {}, { passive: true });
