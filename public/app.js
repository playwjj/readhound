// 字游记 — child app. One page, views rendered into #app.
// Flow per article: 生字预热 → 读前任务 → 分段阅读 → 闯关题 → 生字小测 → 结算
import { pupSVG } from "./pup.js";

const $app = document.getElementById("app");
const state = { home: null, me: null };

// ================================================================ helpers
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v;
    else if (k === "class") el.className = v;
    else if (k === "style") el.style.cssText = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}
function show(...nodes) {
  $app.classList.remove("wide");
  $app.replaceChildren(...nodes.flat().filter((n) => n != null && n !== false));
  window.scrollTo(0, 0);
}
/** Same, for pages that use the full width in landscape (two columns); reading pages stay narrow. */
function showWide(...nodes) {
  show(...nodes);
  $app.classList.add("wide");
}
function toast(msg, ms = 2200) {
  const t = h("div", { class: "toast" }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}
class Offline extends Error {
  constructor() {
    super("网络断开了");
    this.offline = true;
  }
}
async function api(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
  } catch {
    throw new Offline();
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    loginView();
    throw new Error("login");
  }
  if (!res.ok) throw new Error(data.error || `出错了（${res.status}）`);
  return data;
}
const isHan = (c) => /\p{Script=Han}/u.test(c);

// ---------------------------------------------------------------- offline store
// Today's opened article is kept on the device so reading continues without
// network; progress waits in a queue and is sent when the network is back.
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const store = {
  get(k) {
    try { return JSON.parse(localStorage.getItem(k)); } catch { return null; }
  },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode / full: reading still works online */ }
  },
};
function cacheSession(extra, data) {
  store.set(`rh_session_${extra ? "extra" : "daily"}`, { day: today(), data });
}
function cachedSession(extra) {
  const c = store.get(`rh_session_${extra ? "extra" : "daily"}`);
  return c && c.day === today() ? c.data : null;
}
/** Merge a progress body into the pending queue (one entry per session; dwell is cumulative). */
function queueProgress(sessionId, body) {
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
async function sendPending() {
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
/** Quest calls need the network (answers are judged on the server). Offline → a gentle note, nothing lost. */
async function questApi(method, path, body) {
  try {
    return await api(method, path, body);
  } catch (e) {
    if (e.offline) toast("闯关需要联网：连上网再点一次，读过的进度都还在", 3200);
    else if (e.message !== "login") toast(e.message);
    return null;
  }
}
function offlineCard(msg, retry) {
  return h("div", { class: "card center", style: "padding:28px 20px" },
    h("div", { style: "font-size:48px" }, "📶"),
    h("p", { style: "font-size:20px" }, msg),
    h("div", { class: "row center" }, h("button", { onclick: retry }, "连上了，再试一次"), R ? h("button", { class: "ghost", onclick: () => readView() }, "先接着读") : null));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- voice
let zhVoice = null;
function pickVoice() {
  const vs = speechSynthesis.getVoices();
  zhVoice = vs.find((v) => /zh[-_]CN/i.test(v.lang) && /Tingting|婷婷|Lili|Yu-shu/i.test(v.name)) || vs.find((v) => /zh[-_]CN/i.test(v.lang)) || null;
}
if ("speechSynthesis" in window) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}
/** Device voice; resolves when finished. */
function speak(text, rate = 0.85) {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) return resolve();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "zh-CN";
    if (zhVoice) u.voice = zhVoice;
    u.rate = rate;
    u.onend = u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}
let currentAudio = null;
function stopAudio() {
  if (currentAudio) currentAudio.pause();
  currentAudio = null;
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}
/** Paragraph read-aloud: pre-generated audio if any, device voice otherwise. */
function playParagraph(p) {
  stopAudio();
  if (p.audio) {
    return new Promise((resolve) => {
      const a = new Audio(p.audio);
      currentAudio = a;
      a.onended = a.onerror = () => resolve();
      a.play().catch(() => speak(p.text, 0.9).then(resolve));
    });
  }
  return speak(p.text, 0.9);
}

// ---------------------------------------------------------------- theme (§15 night mode)
function applyTheme() {
  const hr = new Date().getHours() + new Date().getMinutes() / 60;
  const night = hr >= 19.5 || hr < 6.5;
  if (night) document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
}
applyTheme();
setInterval(applyTheme, 5 * 60000);

// ---------------------------------------------------------------- screen time + rest page
const clock = {
  screenDelta: 0, // ms since last flush (all foreground time counts toward the daily limit)
  sinceRest: 0, // ms of screen time since the last rest page
  lastTick: Date.now(),
  lastTouch: Date.now(),
  onTick: null,
  sessionMin: 15,
  restMin: 2,
  resting: false,
};
["pointerdown", "keydown", "scroll", "touchstart"].forEach((ev) => addEventListener(ev, () => (clock.lastTouch = Date.now()), { passive: true }));
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(now - clock.lastTick, 5000);
  clock.lastTick = now;
  if (document.visibilityState !== "visible" || clock.resting) return;
  clock.screenDelta += dt;
  clock.sinceRest += dt;
  if (clock.onTick) clock.onTick(dt, now);
  if (clock.sessionMin > 0 && clock.sinceRest >= clock.sessionMin * 60000) restPage();
}, 1000);

function restPage() {
  if (clock.resting) return;
  clock.resting = true;
  stopAudio();
  let left = Math.max(0, clock.restMin * 60);
  const tips = [
    "看看窗外最远的地方，找一找有几种颜色。",
    "眨眨眼睛，转一转眼珠：上、下、左、右。",
    "站起来伸个懒腰，学小猎犬抖一抖。",
  ];
  const count = h("div", { class: "count" });
  const btn = h("button", { class: "big", hidden: true, onclick: () => { clock.resting = false; clock.sinceRest = 0; el.remove(); } }, "休息好了，继续");
  const el = h("div", { class: "rest" },
    h("div", { style: "font-size:64px" }, "🌳"),
    h("h2", {}, "小猎犬说：眼睛要休息啦"),
    h("p", {}, tips[Math.floor(Math.random() * tips.length)]),
    h("p", { style: "opacity:.8;font-size:17px" }, "读书时记得：眼离书本一尺，胸离桌子一拳，手离笔尖一寸。"),
    count, btn);
  document.body.append(el);
  const tick = () => {
    if (left <= 0) {
      count.textContent = "✓";
      btn.hidden = false;
      return;
    }
    count.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
    left--;
    setTimeout(tick, 1000);
  };
  tick();
}

// ================================================================ login
function loginView() {
  let pin = "";
  const dots = h("div", { class: "pin-dots" });
  const err = h("div", { class: "err" });
  const draw = () => dots.replaceChildren(...[0, 1, 2, 3, 4, 5].slice(0, Math.max(4, pin.length)).map((i) => h("i", { class: i < pin.length ? "on" : "" })));
  const press = async (k) => {
    err.textContent = "";
    if (k === "⌫") pin = pin.slice(0, -1);
    else if (k === "✓") {
      try {
        const r = await api("POST", "/api/login", { pin });
        if (r.role === "parent" && location.search.includes("parent")) location.href = "/parent.html";
        else boot();
        return;
      } catch (e) {
        if (e.message !== "login") err.textContent = e.message;
        pin = "";
      }
    } else if (pin.length < 8) pin += k;
    draw();
  };
  draw();
  show(h("div", { class: "pin-wrap" },
    h("div", { html: pupSVG("young", [], "happy"), style: "width:140px;margin:0 auto" }),
    h("h1", {}, "字游记"),
    h("p", { class: "muted" }, "输入密码，小猎犬就来陪你读书"),
    dots, err,
    h("div", { class: "pad" }, ..."123456789⌫0✓".split("").map((k) => h("button", { onclick: () => press(k) }, k)))));
}

// ================================================================ home
async function boot() {
  try {
    state.home = await api("GET", "/api/home");
    sendPending();
  } catch (e) {
    if (e.message === "login") return;
    const cached = e.offline && cachedSession(false);
    show(h("div", { class: "card center" },
      h("p", {}, e.offline ? "现在没有网络。" : "网络不太顺，检查一下再打开。"),
      cached ? h("p", { class: "muted" }, `今天的《${cached.article.title}》已经存在平板里，可以先读，进度联网后会同步。`) : null,
      h("div", { class: "row center" },
        cached ? h("button", { class: "big", onclick: () => startReading(false) }, "离线接着读") : null,
        h("button", { class: cached ? "ghost" : "", onclick: boot }, "再试一次"))));
    return;
  }
  clock.sessionMin = state.home.eye.sessionMin;
  clock.restMin = state.home.eye.restMin;
  if (state.home.needAssessment) return assessmentIntro();
  homeView();
}

function greeting(H) {
  const name = H.childName || "小读者";
  if (H.todayDone) return h("div", { class: "say" }, `${name}，今天的阅读完成啦！小猎犬为你骄傲。`);
  if (H.session && H.session.level < 2) return h("div", { class: "say" }, `${name}，接着读上次的故事吧！`);
  if (H.streak > 0) return h("div", { class: "say" }, `${name}，已经连续读了 `, h("b", {}, H.streak), ` 天，今天继续！`);
  return h("div", { class: "say" }, `${name}，小猎犬闻到了一个新故事的味道……`);
}

function homeView() {
  const H = state.home;
  const todayCard = h("div", { class: "card today" });
  if (!H.article) {
    todayCard.append(h("div", { class: "title" }, "今天的故事还在准备中"), h("p", { class: "meta" }, "请爸爸妈妈在家长页添加文章，晚点再来看看。"));
  } else {
    if (H.todayDone) todayCard.append(h("div", { class: "done-badge" }, "✓ 今日已通关"));
    todayCard.append(
      h("div", { class: "muted" }, "今日一篇"),
      h("div", { class: "title" }, H.article.title),
      h("div", { class: "meta" }, [H.article.genre, `${H.article.chars} 字`, "约 12 分钟"].filter(Boolean).join(" · ")));
    if (H.eye.listenOnly) {
      todayCard.append(h("p", { class: "muted" }, H.eye.reason === "bedtime" ? "🌙 现在是睡前时间，只能听故事哦。" : "👀 今天看屏幕够久啦，剩下的时间听故事吧。"));
    }
    const btns = h("div", { class: "row center" });
    if (!H.todayDone) {
      btns.append(h("button", { class: "big", onclick: () => startReading(false) }, H.session ? "继续阅读" : "开始阅读"));
    } else {
      btns.append(h("button", { class: "soft", onclick: () => startReading(false) }, "再看一遍"));
      if (H.canExtra && !H.eye.listenOnly) btns.append(h("button", { onclick: () => startReading(true) }, "再读一篇 🦴"));
    }
    todayCard.append(btns);
  }

  const map = mapStrip(H.map, H.completed);
  showWide(
    h("div", { class: "topbar" },
      h("h1", {}, "字游记"), h("div", { class: "spacer" }),
      h("span", { class: "chip", title: "连续天数" }, "🔥 ", H.streak, H.freezes ? h("small", { class: "muted", title: "补签卡" }, ` ❄${H.freezes}`) : null),
      h("span", { class: "chip", title: "骨头" }, "🦴 ", H.bones)),
    h("div", { class: "home-grid" }, h("div", {},
    h("div", { class: "card hero" },
      h("div", { class: "pup", html: pupSVG(H.puppy.key, H.accessories) }),
      h("div", {}, greeting(H),
        h("div", { class: "muted", style: "font-size:15px;margin-top:6px" },
          `小猎犬等级：${H.puppy.name}`, H.puppy.next ? `（再读 ${H.puppy.next.need} 篇变成${H.puppy.next.name}）` : ""))),
    todayCard), h("div", {},
    h("div", { class: "stats" },
      h("div", { class: "stat" }, h("b", {}, H.completed), h("span", {}, "读完的文章")),
      h("div", { class: "stat" }, h("b", {}, H.tamedChars), h("span", {}, "驯服的生字")),
      h("div", { class: "stat" }, h("b", {}, H.knownChars), h("span", {}, "认识的字"))),
    h("div", { class: "card map-card" },
      h("div", { class: "row" }, h("b", {}, `🗺 ${H.map.region}`), h("span", { class: "spacer" }), h("span", { class: "muted" }, `第 ${H.map.node + 1} / ${H.map.perRegion} 站`)),
      map),
    h("div", { class: "nav" },
      h("button", { onclick: collectionView }, h("span", { class: "ico" }, "📖"), "生字图鉴"),
      h("button", { onclick: mapView }, h("span", { class: "ico" }, "🗺"), "闯关地图"),
      h("button", { onclick: skillsView }, h("span", { class: "ico" }, "🎒"), "技能法宝")))),
    h("div", { class: "foot" }, h("a", { href: "/parent.html" }, "家长入口")));
}

function mapStrip(m, completed) {
  const wrap = h("div", { class: "map-strip" });
  for (let i = 0; i < m.perRegion; i++) {
    if (i) wrap.append(h("div", { class: "path" + (i <= m.node ? " lit" : "") }));
    wrap.append(h("div", { class: "node" + (i < m.node ? " lit" : "") + (i === m.node ? " here" : "") }, i < m.node ? "★" : i + 1));
  }
  void completed;
  return wrap;
}

// ================================================================ assessment (§5 冷启动测评)
function assessmentIntro() {
  show(h("div", { class: "card center", style: "padding:30px 22px" },
    h("div", { html: pupSVG("pup"), style: "width:150px;margin:0 auto" }),
    h("h2", {}, "小猎犬想先认识你！"),
    h("p", {}, "我们来玩一个找拼音的游戏：每次出现一个字，点出它的读音。"),
    h("p", { class: "muted" }, "不认识的字，就点“不认识”，一点也不丢人——这样小猎犬才知道给你准备什么故事。大约 10 分钟。"),
    h("button", { class: "big", onclick: () => runAssessment() }, "开始游戏")));
}

async function runAssessment() {
  const seed = Math.floor(Math.random() * 100000);
  const results = [];
  for (let level = 0, levels = 1; level < levels; level++) {
    const L = await api("GET", `/api/assessment/level/${level}?seed=${seed}`);
    levels = L.levels;
    let right = 0;
    for (let i = 0; i < L.items.length; i++) {
      const it = L.items[i];
      const choice = await new Promise((resolve) => {
        show(h("div", { class: "card warm-card" },
          h("div", { class: "muted" }, `第 ${level + 1} 关 · ${i + 1}/${L.items.length}`),
          h("div", { class: "big" }, it.char),
          h("div", { class: "opts py", style: "margin-top:14px" },
            ...it.options.map((o) => h("button", { onclick: () => resolve(o) }, o)),
            h("button", { class: "soft", style: "font-size:20px", onclick: () => resolve(null) }, "不认识"))));
      });
      results.push({ level, char: it.char, choice });
      if (choice != null && choice === it.options[it.a]) right++;
    }
    // stop at the first level where fewer than half were right (§5: 测到连续错一档为止)
    if (right / L.items.length < 0.5) break;
    if (level < levels - 1) {
      await new Promise((resolve) => show(h("div", { class: "card center", style: "padding:30px" },
        h("h2", {}, `第 ${level + 1} 关完成！`), h("p", {}, "下一关的字会难一点点。"),
        h("div", { class: "row center" }, h("button", { onclick: resolve }, "继续"), h("button", { class: "ghost", onclick: () => { level = 99; resolve(); } }, "今天先到这儿")))));
    }
  }
  const r = await api("POST", "/api/assessment/finish", { results });
  show(h("div", { class: "card center", style: "padding:30px 22px" },
    h("div", { html: pupSVG("young", [], "happy"), style: "width:150px;margin:0 auto" }),
    h("h2", {}, "测完啦！"),
    h("p", { style: "font-size:22px" }, "小猎犬估计你已经认识大约 ", h("b", {}, r.estimate), " 个字。"),
    h("p", { class: "muted" }, `差不多到了课本${r.reached}的水平。接下来的故事会照着你认识的字来挑：每篇只有几个新朋友，一个一个驯服它们。`),
    h("button", { class: "big", onclick: boot }, "去看今天的故事")));
}

// ================================================================ reading flow
let R = null; // current session state

async function startReading(extra) {
  let data;
  try {
    data = await api("POST", "/api/session/start", { extra });
    cacheSession(extra, data);
  } catch (e) {
    if (e.message === "login") return;
    data = e.offline ? cachedSession(extra) : null;
    if (!data) return toast(e.offline ? "没有网络，今天的故事还没下载到平板上" : e.message);
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
  R = {
    ...data,
    idx: Math.min(data.session.lastParagraph, data.article.paragraphs.length - 1),
    dwell: data.article.paragraphs.map((_, i) => data.session.dwell[i] || 0),
    activeMs: data.session.activeMs || 0,
    taps: [],
    answered,
    quiz: new Map(data.session.quizDone.map((q) => [q.char, q])),
    mode: localStorage.getItem("rh_mode") || "self",
    stage: "warmup",
    newSet: new Set(data.newChars.map((c) => c.char)),
    reviewSet: new Set(data.reviewChars.map((c) => c.char)),
    glossOf: new Map([...data.newChars, ...data.reviewChars].map((c) => [c.char, c])),
  };
  clock.onTick = readingTick;
  const flushTimer = setInterval(() => R && flush(), 15000);
  R.stopFlush = () => clearInterval(flushTimer);

  if (data.session.level >= 2) return resultView(null, true);
  if (data.eye.listenOnly) return listenOnlyView();
  const allQ = [...data.questions, ...(data.guess ? [data.guess] : []), ...data.locates, ...data.sections];
  const questDone = allQ.length && allQ.every((q) => answered.get(q.id)?.correct || (answered.get(q.id)?.attempts || 0) >= 2);
  if (questDone) return charQuizView();
  if (data.session.lastParagraph > 0 || answered.size) return readView();
  warmupView();
}

/** Accrue reading time to the paragraph on screen (only while the child is active). */
function readingTick(dt, now) {
  if (!R || R.stage !== "read") return;
  const idle = now - clock.lastTouch > 90000 && !(currentAudio && !currentAudio.paused) && !(window.speechSynthesis && speechSynthesis.speaking);
  if (idle) return;
  R.dwell[R.idx] = (R.dwell[R.idx] || 0) + dt;
  R.activeMs += dt;
}

async function flush() {
  if (!R) return;
  const body = { lastParagraph: R.idx, dwell: R.dwell, activeMs: R.activeMs, taps: R.taps.splice(0), screenMsDelta: clock.screenDelta };
  clock.screenDelta = 0;
  // keep the on-device copy at the current position, so an offline reopen resumes here
  const key = `rh_session_${R.session.daily ? "daily" : "extra"}`;
  const c = store.get(key);
  if (c && c.data.session.id === R.session.id) {
    Object.assign(c.data.session, { lastParagraph: Math.max(c.data.session.lastParagraph, R.idx), dwell: R.dwell, activeMs: R.activeMs });
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
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") { flush(); stopAudio(); } });

function leaveReading() {
  stopAudio();
  flush();
  if (R?.stopFlush) R.stopFlush();
  clock.onTick = null;
  R = null;
  boot();
}

function header(title, pct) {
  return [
    h("div", { class: "reader-head" },
      h("button", { class: "ghost small", onclick: leaveReading }, "← 回家"),
      h("div", { class: "t" }, title)),
    pct != null ? h("div", { class: "progress" }, h("i", { style: `width:${Math.round(pct * 100)}%` })) : null,
  ];
}

// ---------------------------------------------------------------- 1. warm-up cards (生字预热)
function warmupView() {
  R.stage = "warmup";
  const cards = R.newChars;
  if (!cards.length) return purposeView();
  let i = 0;
  const draw = () => {
    const c = cards[i];
    show(...header(R.article.title, 0),
      h("p", { class: "center muted" }, `读之前，先认识 ${cards.length} 个新朋友`),
      h("div", { class: "card warm-card" },
        h("div", { class: "big" }, c.char),
        h("div", { class: "py" }, c.pinyin),
        c.word && c.word !== c.char ? h("div", { class: "word" }, c.word) : null,
        c.gloss ? h("div", { class: "gloss" }, c.gloss) : null,
        c.example ? h("div", { class: "gloss" }, `例：${c.example}`) : null,
        h("div", { class: "row center", style: "margin-top:14px" },
          h("button", { class: "soft", onclick: () => speak(c.word || c.char) }, "🔊 听一听"))),
      h("div", { class: "dots" }, ...cards.map((_, k) => h("i", { class: k === i ? "on" : "" }))),
      h("div", { class: "row center" },
        i > 0 ? h("button", { class: "ghost", onclick: () => { i--; draw(); } }, "上一个") : null,
        h("button", { onclick: () => { if (++i < cards.length) draw(); else matchGame(); } }, i < cards.length - 1 ? "下一个" : "玩个小游戏")));
    speak(c.char);
  };
  draw();
}

/** 30-second warm-up game: hear a character, tap it (§6 读前预热). */
async function matchGame() {
  const cards = R.newChars;
  if (cards.length < 2) return purposeView();
  const rounds = Math.min(3, cards.length);
  const order = [...cards].sort(() => Math.random() - 0.5).slice(0, rounds);
  for (let r = 0; r < order.length; r++) {
    const target = order[r];
    const opts = [target, ...cards.filter((c) => c !== target).sort(() => Math.random() - 0.5).slice(0, 2)].sort(() => Math.random() - 0.5);
    await new Promise((resolve) => {
      const fb = h("div", { class: "feedback", hidden: true });
      const say = () => speak(target.word || target.char);
      show(...header(R.article.title, 0.05),
        h("div", { class: "card center" },
          h("div", { class: "muted" }, `听音找字 ${r + 1}/${order.length}`),
          h("button", { class: "big soft", style: "margin:14px 0", onclick: say }, "🔊 再听一遍"),
          h("div", { class: "opts py" }, ...opts.map((o) => h("button", {
            style: "font-size:48px;font-family:'Kaiti SC','STKaiti',serif",
            onclick: (e) => {
              if (o === target) {
                e.currentTarget.classList.add("right");
                fb.className = "feedback ok";
                fb.textContent = `对啦！“${o.char}”读 ${o.pinyin}`;
                fb.hidden = false;
                setTimeout(resolve, 900);
              } else {
                e.currentTarget.classList.add("nope");
                fb.className = "feedback try";
                fb.textContent = `这是“${o.char}”（${o.pinyin}），再听听看`;
                fb.hidden = false;
              }
            },
          }, o.char))), fb));
      setTimeout(say, 300);
    });
  }
  purposeView();
}

// ---------------------------------------------------------------- 2. pre-reading task (带着问题读)
function purposeView() {
  if (!R.purpose) return readView();
  show(...header(R.article.title, 0.08),
    h("div", { class: "card center", style: "padding:28px 22px" },
      h("div", { style: "font-size:56px" }, "🔍"),
      h("h2", {}, "接到一个侦察任务！"),
      h("div", { class: "task", style: "text-align:left" }, h("div", { class: "lbl" }, "带着问题读"), R.purpose.task),
      h("p", { class: "muted" }, "读完以后，小猎犬会考考你这个任务哦。"),
      h("button", { class: "big", onclick: readView }, "开始读")));
}

// ---------------------------------------------------------------- 3. reading (分段)
function rubyPara(p, i) {
  const syl = p.py ? p.py.split(" ") : [];
  let k = 0;
  const box = h("div", { class: "para", "data-i": i }, h("span", { class: "no" }, `第 ${i + 1} 段`));
  const mode = R.settings.pinyin; // all | new | off
  if (mode !== "off") box.classList.add("with-py");
  for (const ch of p.text) {
    if (!isHan(ch)) {
      box.append(ch);
      continue;
    }
    const py = syl[k++] || "";
    const isNew = R.newSet.has(ch), isRev = R.reviewSet.has(ch);
    const showPy = mode === "all" || (mode === "new" && (isNew || isRev));
    const node = showPy ? h("ruby", { class: "hz" }, ch, h("rt", {}, py)) : h("span", { class: "hz" }, ch);
    if (isNew) node.classList.add("new");
    else if (isRev) node.classList.add("review");
    node.dataset.c = ch;
    node.dataset.py = py;
    box.append(node);
  }
  box.addEventListener("click", (e) => {
    const t = e.target.closest(".hz");
    if (t) charPopover(t.dataset.c, t.dataset.py, t);
  });
  return box;
}

let popEl = null;
function charPopover(ch, py, node) {
  if (popEl) popEl.remove();
  if (R) R.taps.push(ch);
  if (node) node.classList.add("tapped");
  const g = R?.glossOf.get(ch);
  speak(ch);
  popEl = h("div", { class: "pop" },
    h("div", { class: "row" },
      h("div", { class: "big" }, ch),
      h("div", {},
        h("div", { class: "py" }, py),
        g?.word && g.word !== ch ? h("div", {}, g.word) : null,
        g?.gloss ? h("div", { class: "muted" }, g.gloss) : null),
      h("div", { class: "spacer" }),
      h("button", { class: "icon soft", onclick: () => speak(g?.word || ch) }, "🔊")),
    h("div", { class: "row end", style: "margin-top:8px" },
      h("button", { class: "ghost small", onclick: () => { popEl.remove(); popEl = null; charModal(ch); } }, "我在哪儿见过它？"),
      h("button", { class: "small", onclick: () => { popEl.remove(); popEl = null; } }, "知道了")));
  document.body.append(popEl);
}

function readView() {
  R.stage = "read";
  clock.onTick = readingTick;
  const paras = R.article.paragraphs;
  const list = h("div", {});
  const actions = h("div", { class: "reader-actions" });
  const prog = h("i", {});
  const modeBtns = [["listen", "🎧 听读"], ["follow", "🗣 跟读"], ["self", "📖 自读"]].map(([k, label]) =>
    h("button", { class: "small" + (R.mode === k ? " on" : ""), onclick: (e) => {
      R.mode = k;
      localStorage.setItem("rh_mode", k);
      modeBtns.forEach((b) => b.classList.remove("on"));
      e.currentTarget.classList.add("on");
      if (k !== "self") autoPlay();
      else stopAudio();
    } }, label));

  const drawParas = () => {
    list.replaceChildren(...paras.slice(0, R.idx + 1).map((p, i) => {
      const el = rubyPara(p, i);
      el.classList.add(i === R.idx ? "current" : "done");
      return el;
    }));
    prog.style.width = `${Math.round(((R.idx + 1) / paras.length) * 85 + 10)}%`;
  };

  const predictHere = () => R.predict && R.idx === R.predict.after && !R.answered.has(R.predict.id);

  /** 预测: stop before the turn of the story; one guess, no right or wrong. */
  const predictCard = () => {
    const p = R.predict;
    const modal = h("div", { class: "modal" }, h("div", { class: "sheet" },
      h("div", { class: "task" }, h("div", { class: "lbl" }, "技能 · 预测"), p.prompt),
      h("p", { class: "muted" }, "先别往下读！根据前面的内容猜一猜。猜什么都可以，读下去就知道了。"),
      h("div", { class: "opts" }, ...p.options.map((o, i) => h("button", { onclick: async () => {
        const r = await questApi("POST", `/api/session/${R.session.id}/answer`, { questionId: p.id, choice: i });
        if (!r) return;
        R.answered.set(p.id, { attempts: 1, correct: i === r.answer, choice: i });
        R.predictResult = r;
        modal.remove();
        toast("记住你的猜测，往下读揭晓！", 2600);
        drawActions();
      } }, o)))));
    document.body.append(modal);
  };

  const revealPrediction = async () => {
    const p = R.predict, mine = R.answered.get(p.id);
    if (!p || !mine || R.revealShown) return;
    R.revealShown = true;
    const r = R.predictResult || await questApi("POST", `/api/session/${R.session.id}/answer`, { questionId: p.id, choice: mine.choice });
    if (!r) return;
    const same = mine.choice === r.answer;
    const modal = h("div", { class: "modal" }, h("div", { class: "sheet" },
      h("div", { class: "task" }, h("div", { class: "lbl" }, "🔮 揭晓"), same ? "你猜中了！" : "故事走向了另一个方向"),
      h("p", {}, "你猜的是：", h("b", {}, p.options[mine.choice])),
      same ? null : h("p", {}, "实际上：", h("b", {}, p.options[r.answer])),
      r.explain ? h("p", { class: "muted" }, r.explain) : null,
      same ? null : h("p", { class: "muted" }, "猜得不一样也很好——作家常常喜欢出人意料。"),
      h("div", { class: "row center" }, h("button", { onclick: () => modal.remove() }, "接着读"))));
    document.body.append(modal);
  };

  const guessHere = () => R.guess && R.guess.paragraph === R.idx && !(R.answered.get(R.guess.id)?.correct || (R.answered.get(R.guess.id)?.attempts || 0) >= 2);

  const drawActions = () => {
    actions.replaceChildren();
    actions.append(h("button", { class: "soft", onclick: () => playParagraph(paras[R.idx]) }, "🔊 读这一段"));
    if (R.readAloud) actions.append(h("button", { class: "soft", onclick: () => { stopAudio(); readAloudCard(R.idx); } }, "🎙 我来读"));
    if (predictHere()) {
      actions.append(h("button", { onclick: () => predictCard() }, "🔮 猜猜后面会怎样"));
      return;
    }
    if (guessHere()) {
      actions.append(h("button", { onclick: () => guessCard() }, "🤔 猜一猜词义"));
      return;
    }
    if (R.idx < paras.length - 1) actions.append(h("button", { class: "big", onclick: next }, "下一段 ↓"));
    else actions.append(h("button", { class: "big", onclick: () => { stopAudio(); flush(); questView(); } }, "读完啦，去闯关 ⚔️"));
  };

  const autoPlay = async () => {
    if (R.mode === "self") return;
    const at = R.idx;
    await playParagraph(paras[at]);
    if (R && R.stage === "read" && R.idx === at && R.mode === "follow") toast("轮到你啦：自己大声读一遍这一段", 3000);
  };

  const next = () => {
    stopAudio();
    R.idx++;
    if (R.predict && R.idx === R.predict.reveal) setTimeout(revealPrediction, 600);
    drawParas();
    drawActions();
    flush();
    const cur = list.querySelector(".para.current");
    if (cur) cur.scrollIntoView({ behavior: "smooth", block: "center" });
    autoPlay();
  };

  const guessCard = () => {
    const g = R.guess;
    const fb = h("div", { class: "feedback", hidden: true });
    const opts = h("div", { class: "opts" });
    const done = () => { modal.remove(); drawActions(); };
    g.options.forEach((o, i) => opts.append(h("button", { onclick: async (e) => {
      const btn = e.currentTarget;
      const r = await questApi("POST", `/api/session/${R.session.id}/answer`, { questionId: g.id, choice: i });
      if (!r) return;
      const st = R.answered.get(g.id) || { attempts: 0, correct: false };
      st.attempts = r.attempt || st.attempts + 1;
      st.correct = st.correct || r.correct;
      R.answered.set(g.id, st);
      fb.hidden = false;
      if (r.correct) {
        btn.classList.add("right");
        fb.className = "feedback ok";
        fb.textContent = `猜对了！${r.explain || ""}`;
        setTimeout(done, 1600);
      } else {
        btn.classList.add("nope");
        btn.disabled = true;
        fb.className = "feedback try";
        fb.textContent = r.later ? "没关系，这个词先放一放，读完再说。" : "再读读这个词前后的句子，换一个试试。";
        if (r.later) setTimeout(done, 1600);
      }
    } }, o)));
    const modal = h("div", { class: "modal" }, h("div", { class: "sheet" },
      h("div", { class: "task" }, h("div", { class: "lbl" }, "技能 · 猜词义"), g.prompt),
      h("p", { class: "muted" }, "先别急着查，联系前后的句子猜一猜。"),
      opts, fb));
    document.body.append(modal);
  };

  show(...header(R.article.title, null),
    h("div", { class: "progress" }, prog),
    h("div", { class: "mode-pick", style: "margin-bottom:12px" }, ...modeBtns),
    R.purpose ? h("div", { class: "task", style: "margin-bottom:12px;font-size:18px" }, h("span", { class: "lbl" }, "任务："), R.purpose.task) : null,
    list, actions,
    h("p", { class: "center muted", style: "font-size:15px" }, "黄色的是新朋友，点任何一个字都能听它的读音。"));
  drawParas();
  drawActions();
  autoPlay();
}

/** Listen-only (bedtime / daily limit): audio, no lit text (§15). */
function listenOnlyView() {
  R.stage = "read";
  const paras = R.article.paragraphs;
  let playing = false;
  const status = h("p", { class: "muted" });
  const btn = h("button", { class: "big-play", onclick: async () => {
    if (playing) { stopAudio(); playing = false; btn.textContent = "▶"; return; }
    playing = true;
    btn.textContent = "⏸";
    for (let i = R.idx; i < paras.length && playing; i++) {
      R.idx = i;
      status.textContent = `正在听第 ${i + 1} / ${paras.length} 段`;
      await playParagraph(paras[i]);
    }
    playing = false;
    btn.textContent = "▶";
    status.textContent = "听完啦，明天再来闯关吧。晚安！";
    flush();
  } }, "▶");
  show(...header(R.article.title, null),
    h("div", { class: "card listen-only" },
      h("div", { html: pupSVG(state.home?.puppy.key, state.home?.accessories, "sleepy"), style: "width:130px;margin:0 auto" }),
      h("h2", {}, R.eye.reason === "bedtime" ? "睡前听故事时间" : "眼睛休息，耳朵听书"),
      h("p", {}, "把平板放下，闭上眼睛听小猎犬讲故事。"),
      btn, status));
}

// ---------------------------------------------------------------- 4. quest questions (闯关)
function lookBack(i, onBack) {
  const p = R.article.paragraphs[i];
  const modal = h("div", { class: "modal" }, h("div", { class: "sheet" },
    h("h3", {}, `第 ${i + 1} 段`),
    rubyPara(p, i),
    h("div", { class: "row center" },
      h("button", { class: "soft", onclick: () => playParagraph(p) }, "🔊 读给我听"),
      h("button", { onclick: () => { stopAudio(); modal.remove(); onBack && onBack(); } }, "找到了，回去答题"))));
  modal.querySelector(".para").classList.add("current");
  document.body.append(modal);
}

function wholeText() {
  const modal = h("div", { class: "modal" }, h("div", { class: "sheet" },
    h("div", { class: "row" }, h("h3", { style: "margin:0" }, R.article.title), h("span", { class: "spacer" }), h("button", { class: "small", onclick: () => modal.remove() }, "关闭")),
    ...R.article.paragraphs.map((p, i) => { const el = rubyPara(p, i); el.classList.add("done"); return el; })));
  document.body.append(modal);
}

/** only: question ids for a retry round (after re-reading). */
async function questView(only) {
  R.stage = "quest";
  const qs = R.questions.filter((q) => (only ? only.includes(q.id) : !(R.answered.get(q.id)?.correct || (R.answered.get(q.id)?.attempts || 0) >= 2)));
  // the pre-reading task's question comes first
  if (R.purpose?.questionId) qs.sort((a, b) => (b.id === R.purpose.questionId) - (a.id === R.purpose.questionId));
  for (let n = 0; n < qs.length; n++) await askQuestion(qs[n], n, qs.length, !!only);
  if (R.guess && only && only.includes(R.guess.id)) await askQuestion({ ...R.guess, abilityName: "猜词义", evidence: R.guess.paragraph }, 0, 1, true);
  const pending = (q) => (only ? only.includes(q.id) : !(R.answered.get(q.id)?.correct || (R.answered.get(q.id)?.attempts || 0) >= 2));
  const locs = R.locates.filter(pending);
  for (let n = 0; n < locs.length; n++) await askLocate(locs[n], n, locs.length, !!only);
  const secs = R.sections.filter(pending);
  if (secs.length) await articleMap(secs, !!only);
  charQuizView();
}

/** Render text with per-character pinyin, consuming syllables from `syl` (shared across sentences). */
function rubyText(text, syl) {
  const frag = document.createDocumentFragment();
  for (const ch of text) {
    if (!isHan(ch)) { frag.append(ch); continue; }
    const py = syl.shift() || "";
    frag.append(R.settings.pinyin === "all" ? h("ruby", { class: "hz" }, ch, h("rt", {}, py)) : h("span", { class: "hz" }, ch));
  }
  return frag;
}

/** 回文定位: tap the sentence that proves the answer. */
function askLocate(q, n, total, retryRound) {
  return new Promise((resolve) => {
    let picked = null;
    const fb = h("div", { class: "feedback", hidden: true });
    const nextBtn = h("button", { class: "big", hidden: true, onclick: resolve }, "继续");
    const confirm = h("button", { disabled: true }, "就是这句 ✓");
    const sentEls = [];
    const paras = q.paras.map((p) => {
      const syl = (R.article.paragraphs[p.index].py || "").split(" ");
      const box = h("div", { class: "para current with-py" }, h("span", { class: "no" }, `第 ${p.index + 1} 段`));
      p.sentences.forEach((text, k) => {
        const key = p.index * 100 + k;
        const el = h("span", { class: "sent", onclick: () => {
          if (el.classList.contains("nope") || !nextBtn.hidden) return;
          sentEls.forEach((x) => x.classList.remove("picked"));
          el.classList.add("picked");
          picked = key;
          confirm.disabled = false;
        } }, rubyText(text, syl));
        el.dataset.key = key;
        sentEls.push(el);
        box.append(el);
      });
      return box;
    });
    confirm.onclick = async () => {
      const r = await questApi("POST", `/api/session/${R.session.id}/answer`, { questionId: q.id, choice: picked });
      if (!r) return;
      const st = R.answered.get(q.id) || { attempts: 0, correct: false };
      st.attempts = r.attempt || st.attempts + 1;
      st.correct = st.correct || r.correct;
      R.answered.set(q.id, st);
      const el = sentEls.find((x) => Number(x.dataset.key) === picked);
      fb.hidden = false;
      if (r.correct) {
        el.classList.replace("picked", "right");
        fb.className = "feedback ok";
        fb.replaceChildren(h("b", {}, "找到了！🐾 "), r.explain || "");
        confirm.hidden = true;
        nextBtn.hidden = false;
      } else {
        el.classList.replace("picked", "nope");
        confirm.disabled = true;
        fb.className = "feedback try";
        if (r.answer != null) {
          sentEls.find((x) => Number(x.dataset.key) === r.answer)?.classList.add("right");
          fb.replaceChildren("这句话还没被找到，绿色的就是依据句。", r.explain ? h("div", {}, r.explain) : "");
          confirm.hidden = true;
          nextBtn.hidden = false;
        } else if (r.later) {
          fb.textContent = "这题有点难，先往下走，等会儿再回来找。";
          confirm.hidden = true;
          nextBtn.hidden = false;
        } else fb.textContent = r.hint || "不是这一句，再找找。";
      }
    };
    show(...header(R.article.title, 0.75),
      h("div", { class: "card" },
        h("div", { class: "row" }, h("span", { class: "ability" }, "回文定位"), retryRound ? h("span", { class: "ability" }, "再试一次") : null,
          h("span", { class: "spacer" }), h("span", { class: "muted" }, `${n + 1} / ${total}`)),
        h("div", { class: "q" }, q.prompt),
        h("p", { class: "muted", style: "margin-top:-8px" }, "在下面的原文里，点出能证明答案的那一句话。")),
      ...paras,
      h("div", { class: "card" }, fb, h("div", { class: "row end", style: "margin-top:10px" }, confirm, nextBtn)));
  });
}

/** 概括段意: one summary per section, then the assembled article map. */
async function articleMap(secs, retryRound) {
  const found = new Map();
  for (let n = 0; n < secs.length; n++) {
    const q = secs[n];
    const idx = await askQuestion({ ...q, abilityName: "概括段意 · 拼文章地图", evidence: q.from }, n, secs.length, retryRound);
    if (idx != null) found.set(q.id, q.options[idx]);
  }
  await new Promise((resolve) => show(...header(R.article.title, 0.85),
    h("div", { class: "card" },
      h("h2", {}, "🗺 文章地图"),
      h("p", { class: "muted" }, "整篇文章就是这样一步步讲下来的："),
      ...R.sections.map((q, i) => h("div", { class: "map-row" },
        h("span", { class: "map-no" }, i + 1),
        h("div", {}, h("div", { class: "muted", style: "font-size:14px" }, `第 ${q.from + 1}${q.to > q.from ? `–${q.to + 1}` : ""} 段`),
          h("div", {}, found.get(q.id) || (R.answered.get(q.id)?.correct ? "✓ 已拼好" : "（这一块还没拼好）"))))),
      h("div", { class: "row end", style: "margin-top:12px" }, h("button", { onclick: resolve }, "继续")))));
}

function askQuestion(q, n, total, retryRound) {
  return new Promise((resolve) => {
    const fb = h("div", { class: "feedback", hidden: true });
    let rightIndex = null; // resolved to the caller (the article map needs it)
    const nextBtn = h("button", { class: "big", hidden: true, onclick: () => resolve(rightIndex) }, n < total - 1 ? "下一题" : "完成闯关");
    const opts = h("div", { class: "opts" });
    const isTask = R.purpose?.questionId === q.id;
    q.options.forEach((o, i) => opts.append(h("button", { onclick: async (e) => {
      const btn = e.currentTarget;
      const r = await questApi("POST", `/api/session/${R.session.id}/answer`, { questionId: q.id, choice: i });
      if (!r) return;
      const st = R.answered.get(q.id) || { attempts: 0, correct: false };
      st.attempts = r.attempt || st.attempts + 1;
      st.correct = st.correct || r.correct;
      R.answered.set(q.id, st);
      fb.hidden = false;
      if (r.correct) {
        rightIndex = i;
        btn.classList.add("right");
        opts.querySelectorAll("button").forEach((b) => (b.disabled = true));
        fb.className = "feedback ok";
        fb.replaceChildren(h("b", {}, "答对了！🐾 "), r.explain || "");
        nextBtn.hidden = false;
      } else if (r.answer != null || r.done) {
        // last try: show the right answer kindly
        rightIndex = r.answer;
        opts.querySelectorAll("button").forEach((b, k) => { b.disabled = true; if (k === r.answer) b.classList.add("right"); });
        fb.className = "feedback try";
        fb.replaceChildren("这道题还没被驯服。正确答案已经标出来了。", r.explain ? h("div", {}, r.explain) : "");
        nextBtn.hidden = false;
      } else if (r.later) {
        btn.classList.add("nope");
        opts.querySelectorAll("button").forEach((b) => (b.disabled = true));
        fb.className = "feedback try";
        fb.textContent = "这道题有点难，我们先往下走，等会儿再回来看看。";
        nextBtn.hidden = false;
      } else {
        btn.classList.add("nope");
        btn.disabled = true;
        fb.className = "feedback try";
        fb.replaceChildren("这个答案还没被驯服 🐾 ", r.hint || "",
          r.evidence != null ? h("div", { style: "margin-top:8px" }, h("button", { class: "small", onclick: () => lookBack(r.evidence) }, `去第 ${r.evidence + 1} 段看看`)) : null);
      }
    } }, `${"ABCD"[i]}. ${o}`)));
    show(...header(R.article.title, 0.6 + 0.25 * (n / Math.max(total, 1))),
      h("div", { class: "card" },
        h("div", { class: "row" },
          h("span", { class: "ability" }, isTask ? "读前任务" : q.abilityName || "闯关"),
          retryRound ? h("span", { class: "ability" }, "再试一次") : null,
          h("span", { class: "spacer" }), h("span", { class: "muted" }, `${n + 1} / ${total}`)),
        h("div", { class: "q" }, q.prompt),
        opts, fb,
        h("div", { class: "row", style: "margin-top:14px" },
          h("button", { class: "ghost small", onclick: wholeText }, "📄 看原文"),
          h("button", { class: "ghost small", onclick: () => speak(q.prompt + "。" + q.options.map((o, i) => `${"ABCD"[i]}，${o}`).join("。")) }, "🔊 读题"),
          h("span", { class: "spacer" }), nextBtn)));
  });
}

// ---------------------------------------------------------------- 5. character quiz (读后生字小测)
async function charQuizView(retryChars) {
  R.stage = "chars";
  const items = R.charQuiz.filter((c) => (retryChars ? retryChars.includes(c.char) : !R.quiz.has(c.char)));
  for (let n = 0; n < items.length; n++) {
    const it = items[n];
    await new Promise((resolve) => {
      const fb = h("div", { class: "feedback", hidden: true });
      const nextBtn = h("button", { hidden: true, onclick: resolve }, n < items.length - 1 ? "下一个" : "看看成绩");
      const word = it.word && it.word !== it.char
        ? h("div", { class: "word", html: it.word.replace(it.char, `<b style="color:var(--accent)">${it.char}</b>`) })
        : null;
      show(...header(R.article.title, 0.88 + 0.1 * (n / items.length)),
        h("div", { class: "card warm-card" },
          h("div", { class: "muted" }, `${retryChars ? "再见一面" : it.review ? "老朋友复习" : "生字小测"} ${n + 1}/${items.length}`),
          h("div", { class: "big" }, it.char), word,
          h("div", { class: "opts py", style: "margin-top:16px" }, ...it.options.map((o) => h("button", { onclick: async (e) => {
            const btn = e.currentTarget;
            const r = await questApi("POST", `/api/session/${R.session.id}/charquiz`, { char: it.char, choice: o, retry: !!retryChars });
      if (!r) return;
            R.quiz.set(it.char, { char: it.char, correct: r.correct });
            btn.parentElement.querySelectorAll("button").forEach((b) => { b.disabled = true; if (b.textContent === r.pinyin) b.classList.add("right"); });
            fb.hidden = false;
            if (r.correct) {
              fb.className = "feedback ok";
              fb.textContent = r.status === "mastered" ? `“${it.char}”被你彻底驯服了！🏅` : `对啦！“${it.char}”读 ${r.pinyin}`;
              speak(it.char);
            } else {
              btn.classList.add("nope");
              fb.className = "feedback try";
              fb.textContent = `“${it.char}”读 ${r.pinyin}，它还没被驯服，过两天再见面。`;
              speak(it.char);
            }
            nextBtn.hidden = false;
          } }, o))),
          fb, h("div", { class: "row center", style: "margin-top:12px" }, nextBtn)));
    });
  }
  finishSession();
}

// ---------------------------------------------------------------- 6. result (结算)
async function finishSession() {
  await flush();
  let r;
  try {
    r = await api("POST", `/api/session/${R.session.id}/finish`);
  } catch (e) {
    if (e.offline) show(offlineCard("快通关了！需要联网才能结算，连上网再点一次。", finishSession));
    else if (e.message !== "login") toast(e.message);
    return;
  }
  resultView(r, false);
}

function confetti() {
  const box = h("div", { class: "confetti" });
  const colors = ["#7b5cc8", "#f2c230", "#3f8f5a", "#3e74b8", "#e86aa0"];
  for (let i = 0; i < 60; i++) {
    box.append(h("i", { style: `left:${Math.random() * 100}%;background:${colors[i % colors.length]};animation-delay:${Math.random() * 0.8}s;animation-duration:${2 + Math.random() * 1.5}s` }));
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 4000);
}

function resultView(res, already) {
  R.stage = "result";
  clock.onTick = null;
  stopAudio();
  if (already || res?.alreadyCompleted) {
    show(...header(R.article.title, 1),
      h("div", { class: "card celebrate" },
        h("h2", {}, "这篇已经通关啦 ✓"),
        h("p", {}, "想再读一遍也可以，不过骨头只发一次哦。"),
        h("div", { class: "row center" },
          h("button", { class: "soft", onclick: wholeText }, "📄 再读一遍"),
          retellButton(),
          h("button", { onclick: leaveReading }, "回家"))));
    return;
  }
  const v = res.verdict;
  if (!v.completed) {
    const canRetryQ = v.retryQuestions.filter((id) => (R.answered.get(id)?.attempts || 0) < R.maxAttempts);
    const missedChars = R.charQuiz.filter((c) => R.quiz.get(c.char) && !R.quiz.get(c.char).correct).map((c) => c.char);
    const charGate = !v.hint || v.hint.includes("生字");
    const actions = h("div", { class: "row center" });
    if (!charGate && canRetryQ.length) {
      const evid = [...new Set(R.questions.concat(R.guess ? [{ id: R.guess.id, evidence: R.guess.paragraph }] : []).filter((q) => canRetryQ.includes(q.id)).map((q) => q.evidence).filter((x) => x != null))];
      actions.append(h("button", { class: "big", onclick: () => {
        if (evid.length) lookBack(evid[0], () => questView(canRetryQ));
        else questView(canRetryQ);
      } }, "回去看看，再答一次"));
    } else if (!charGate && (v.tooFast || !v.readBody)) {
      // skimmed: reading again slowly is the way through (the answers already stand)
      actions.append(h("button", { class: "big", onclick: () => { R.idx = 0; readView(); } }, "慢慢再读一遍"));
    } else if (charGate && missedChars.length) {
      actions.append(h("button", { class: "big", onclick: () => reMeetChars(missedChars) }, "再和生字见一面"));
    }
    actions.append(h("button", { class: "ghost", onclick: leaveReading }, "今天先到这儿"));
    show(...header(R.article.title, 0.95),
      h("div", { class: "card celebrate" },
        h("div", { html: pupSVG(state.home?.puppy.key, state.home?.accessories), style: "width:120px;margin:0 auto" }),
        h("h2", {}, "差一点点就通关了！"),
        h("p", { style: "font-size:20px" }, v.hint || "再读一读，答案就藏在文章里。"),
        actions));
    return;
  }
  confetti();
  const rw = res.rewards;
  const chestBox = h("div", {});
  if (rw.chest) {
    const chestBtn = h("button", { class: "chest", onclick: () => {
      chestBtn.remove();
      chestBox.append(h("div", { class: "surprise" }, rw.chest.kind === "accessory" ? "🎁 " : rw.chest.kind === "fact" ? "💡 冷知识：" : "😄 ", rw.chest.text));
    } }, "🎁");
    chestBox.append(h("div", { class: "muted" }, "点开惊喜宝箱"), chestBtn);
  }
  showWide(...header(R.article.title, 1),
    h("div", { class: "card celebrate split" }, h("div", {},
      h("div", { html: pupSVG(rw.puppy.key, state.home?.accessories || [], "happy"), style: "width:150px;margin:0 auto" }),
      h("h2", {}, R.session.daily ? "今日阅读完成！" : "又读完一篇！"),
      rw.puppyGrew ? h("p", { class: "surprise" }, `🎉 小猎犬长大了，变成了${rw.puppy.name}！`) : null,
      h("div", { style: "text-align:left;margin:16px 0" },
        ...rw.bones.map((g) => h("div", { class: "gain" }, h("span", {}, g.reason), h("b", {}, `+${g.amount} 🦴`))),
        h("div", { class: "gain" }, h("span", {}, "骨头总数"), h("b", {}, rw.balance)))), h("div", {},
      R.session.daily ? h("p", {}, "🔥 连续阅读 ", h("b", {}, rw.streak), " 天", rw.freezeEarned ? "，还得到一张补签卡 ❄" : "") : null,
      h("p", { class: "muted" }, `🗺 ${rw.map.region} 第 ${rw.map.node || rw.map.perRegion} 站点亮了`),
      rw.medals.length ? h("div", {}, ...rw.medals.map((m) => h("span", { class: "medal" }, "🏅 ", m.title))) : null,
      chestBox,
      h("div", { class: "row center", style: "margin-top:16px" },
        retellButton(),
        h("button", { class: "big", onclick: leaveReading }, "回家")))));
}

// ---------------------------------------------------------------- read aloud (朗读流利度)
/** Record from the microphone: returns {start, stop} and calls onDone(blob, ms). */
function recorder(onDone, onError, maxMs = 120000) {
  let rec = null, stream = null, t0 = 0, cap = null;
  return {
    supported: !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder),
    get recording() { return rec?.state === "recording"; },
    async start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        return onError("需要允许使用麦克风才能录音。请让爸爸妈妈在设置里打开。");
      }
      const chunks = [];
      rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        clearTimeout(cap);
        stream.getTracks().forEach((t) => t.stop());
        onDone(new Blob(chunks, { type: rec.mimeType || "audio/mp4" }), Date.now() - t0);
      };
      rec.start();
      t0 = Date.now();
      cap = setTimeout(() => rec.state === "recording" && rec.stop(), maxMs);
    },
    stop() { if (rec?.state === "recording") rec.stop(); },
  };
}

function readAloudCard(i) {
  const p = R.article.paragraphs[i];
  const paraEl = rubyPara(p, i);
  paraEl.classList.add("current");
  const status = h("p", { class: "muted" }, "按“开始读”，把这一段大声读一遍，读完按“读完了”。");
  const out = h("div", {});
  const close = h("button", { class: "ghost", onclick: () => modal.remove() }, "接着读");
  const btn = h("button", { class: "big" }, "🎙 开始读");
  const r = recorder(async (blob, ms) => {
    btn.disabled = true;
    btn.textContent = "🎙 再读一遍";
    status.textContent = "小猎犬正在认真听……";
    try {
      const res = await fetch(`/api/session/${R.session.id}/fluency?para=${i}&ms=${ms}`, { method: "POST", body: blob, headers: { "content-type": blob.type }, credentials: "same-origin" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "出错了");
      if (d.tooShort) { status.textContent = d.message; btn.disabled = false; return; }
      showResult(d);
      btn.disabled = d.left <= 0;
    } catch (e) {
      status.textContent = e.message === "Failed to fetch" ? "需要联网才能听你读，连上网再试试。" : e.message;
      btn.disabled = false;
    }
  }, (msg) => { status.textContent = msg; });
  btn.onclick = () => {
    if (r.recording) return r.stop();
    out.replaceChildren();
    paraEl.querySelectorAll(".hz.miss").forEach((x) => x.classList.remove("miss"));
    r.start();
    btn.textContent = "⏹ 读完了";
    status.textContent = "正在听……";
  };
  function showResult(d) {
    const pct = Math.round(d.accuracy * 100);
    const hz = [...paraEl.querySelectorAll(".hz")];
    d.missed.forEach((m) => hz[m.index]?.classList.add("miss"));
    status.textContent = "";
    out.replaceChildren(
      h("div", { class: `feedback ${pct >= 80 ? "ok" : "try"}` },
        h("b", {}, pct >= 95 ? "读得又准又顺！🎉 " : pct >= 80 ? "读得不错！🐾 " : "读完啦！有几个地方再读读。 "),
        `读准了 ${pct}%，每分钟 ${d.cpm} 字。`),
      d.practise.length ? h("div", { style: "margin-top:10px" }, h("span", { class: "muted" }, "这几个地方再读读（点一下听）："),
        ...d.practise.map((w) => h("button", { class: "small soft", style: "margin:4px", onclick: () => speak(w) }, `🔊 ${w}`))) : null);
  }
  const modal = h("div", { class: "modal" }, h("div", { class: "sheet" },
    h("div", { class: "task" }, h("div", { class: "lbl" }, "技能 · 大声朗读"), `第 ${i + 1} 段`),
    paraEl,
    r.supported ? status : h("p", {}, "这台设备的浏览器不支持录音。"),
    out,
    h("div", { class: "row center", style: "margin-top:12px" }, r.supported ? btn : null, close)));
  document.body.append(modal);
}

// ---------------------------------------------------------------- 7. voice retelling (语音复述)
function retellButton() {
  if (!R.retell || R.retell.triesLeft <= 0) return null;
  return h("button", { class: "soft", onclick: retellView }, "🎤 讲给小猎犬听 +3🦴");
}

function retellView() {
  const canRecord = !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  const status = h("p", { class: "muted" }, "按下按钮，用自己的话把故事讲一遍：讲了什么事、谁做了什么、最后怎样了。");
  const timer = h("div", { class: "count", style: "font-size:40px;font-variant-numeric:tabular-nums" }, "0:00");
  const out = h("div", {});
  let rec = null, chunks = [], t0 = 0, tick = null, stream = null;
  const btn = h("button", { class: "big", disabled: !canRecord, onclick: async () => {
    if (rec && rec.state === "recording") return rec.stop();
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      status.textContent = "需要允许使用麦克风才能录音。请让爸爸妈妈在设置里打开。";
      return;
    }
    chunks = [];
    rec = new MediaRecorder(stream);
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      clearInterval(tick);
      stream.getTracks().forEach((t) => t.stop());
      btn.textContent = "🎤 再讲一遍";
      btn.disabled = true;
      status.textContent = "小猎犬正在认真听……";
      const blob = new Blob(chunks, { type: rec.mimeType || "audio/mp4" });
      try {
        const res = await fetch(`/api/session/${R.session.id}/retell`, { method: "POST", body: blob, headers: { "content-type": blob.type }, credentials: "same-origin" });
        const r = await res.json();
        if (!res.ok) throw new Error(r.error || "出错了");
        showRetell(r);
      } catch (e) {
        status.textContent = e.message === "Failed to fetch" ? "需要联网才能听你讲，连上网再试试。" : e.message;
        btn.disabled = false;
      }
    };
    rec.start();
    t0 = Date.now();
    btn.textContent = "⏹ 讲完了";
    status.textContent = "正在听……讲完按“讲完了”。";
    tick = setInterval(() => {
      const sec = Math.floor((Date.now() - t0) / 1000);
      timer.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
      if (sec >= 120) rec.stop(); // two minutes is plenty
    }, 250);
  } }, "🎤 开始讲");

  function showRetell(r) {
    if (r.tooShort) {
      status.textContent = r.message;
      btn.disabled = false;
      return;
    }
    R.retell.triesLeft = r.triesLeft;
    if (r.passed) confetti();
    status.textContent = "";
    out.replaceChildren(
      h("div", { class: `feedback ${r.passed ? "ok" : "try"}` }, h("b", {}, r.passed ? "讲得真棒！🎉 " : "讲得不错！ "), r.feedback,
        r.bones ? h("div", {}, `完成复述 +${r.bones} 🦴`) : null),
      h("div", { class: "card", style: "margin-top:12px;box-shadow:none;border:1px solid var(--line)" },
        h("b", {}, `你讲到了 ${r.covered.length} 件重要的事：`),
        ...r.covered.map((p) => h("div", {}, "✓ ", p)),
        r.missed.length ? h("div", { class: "muted", style: "margin-top:8px" }, "还可以讲讲：", r.missed.join("；")) : null,
        r.tip ? h("div", { class: "muted" }, "💡 ", r.tip) : null),
      h("details", { style: "margin-top:8px" }, h("summary", { class: "muted" }, "小猎犬听到的话"), h("p", {}, r.transcript)));
    btn.disabled = !(r.triesLeft > 0) || r.passed;
    if (r.passed || r.triesLeft <= 0) btn.hidden = true;
  }

  show(...header(R.article.title, 1),
    h("div", { class: "card center", style: "padding:26px 20px" },
      h("div", { html: pupSVG(state.home?.puppy.key, state.home?.accessories, "happy"), style: "width:110px;margin:0 auto" }),
      h("h2", {}, "讲给小猎犬听"),
      canRecord ? status : h("p", {}, "这台设备的浏览器不支持录音。"),
      timer, btn, out,
      h("div", { class: "row center", style: "margin-top:16px" }, h("button", { class: "ghost", onclick: leaveReading }, "回家"))));
}

async function reMeetChars(chars) {
  for (const ch of chars) {
    const c = R.glossOf.get(ch);
    await new Promise((resolve) => {
      show(...header(R.article.title, 0.9),
        h("p", { class: "center muted" }, "再看一眼这个新朋友"),
        h("div", { class: "card warm-card" },
          h("div", { class: "big" }, ch), h("div", { class: "py" }, c?.pinyin || ""),
          c?.word && c.word !== ch ? h("div", { class: "word" }, c.word) : null,
          c?.gloss ? h("div", { class: "gloss" }, c.gloss) : null,
          h("div", { class: "row center", style: "margin-top:12px" },
            h("button", { class: "soft", onclick: () => speak(c?.word || ch) }, "🔊"), h("button", { onclick: resolve }, "记住了"))));
      speak(ch);
    });
  }
  charQuizView(chars);
}

// ================================================================ archive / collection / map / skills
async function charModal(ch) {
  const c = await api("GET", `/api/chars/${encodeURIComponent(ch)}`);
  const statusName = { unseen: "还没见过", seen: "见过", familiar: "认识", mastered: "已驯服" }[c.status];
  const modal = h("div", { class: "modal", onclick: (e) => { if (e.target === modal) modal.remove(); } }, h("div", { class: "sheet" },
    h("div", { class: "row" },
      h("div", { class: "ccard", style: "min-width:120px" }, h("div", { class: "big" }, c.char), h("div", { class: "py" }, c.pinyin)),
      h("div", {},
        h("div", {}, h("b", {}, statusName), c.firstSeenAt ? h("span", { class: "muted" }, ` · ${c.firstSeenAt} 第一次见`) : null),
        c.word ? h("div", {}, c.word) : null,
        c.gloss ? h("div", { class: "muted" }, c.gloss) : null,
        c.status !== "mastered" && c.status !== "unseen" ? h("div", { class: "muted", style: "font-size:15px" }, `在 ${c.correctArticles} 篇文章里答对过（3 篇就驯服啦）`) : null,
        c.textbook?.recognise ? h("div", { class: "muted", style: "font-size:15px" }, `课本：${c.textbook.recognise}认识${c.textbook.write ? `，${c.textbook.write}会写` : ""}`) : null),
      h("span", { class: "spacer" }),
      h("button", { class: "icon soft", onclick: () => speak(c.word || c.char) }, "🔊")),
    h("h3", {}, `🐾 在这些故事里见过（${c.seenIn.length}）`),
    c.seenIn.length ? h("div", {}, ...c.seenIn.map((s) => h("div", { class: "list-item", onclick: () => { modal.remove(); rereadView(s.articleId, c.char); } },
      h("div", { style: "flex:1" }, h("b", {}, s.title), h("div", { class: "snippet", html: escapeHTML(s.snippet).replaceAll(c.char, `<mark>${c.char}</mark>`) })),
      h("span", { class: "muted" }, `${s.occurrences} 次 ›`)))) : h("p", { class: "muted" }, "还没在读过的故事里见过它。"),
    c.moreInLibrary > 0 ? h("p", { class: "muted" }, `书库里还有 ${c.moreInLibrary} 篇故事藏着这个字，以后会遇到的。`) : null,
    h("div", { class: "row center" }, h("button", { onclick: () => modal.remove() }, "关闭"))));
  document.body.append(modal);
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

async function rereadView(id, focusChar) {
  const a = await api("GET", `/api/articles/${id}`);
  const saveR = R;
  R = { newSet: new Set(focusChar ? [focusChar] : []), reviewSet: new Set(), glossOf: new Map(), settings: { pinyin: "all" }, taps: [] };
  const paras = a.paragraphs.map((p, i) => { const el = rubyPara(p, i); el.classList.add("current"); return el; });
  show(h("div", { class: "reader-head" }, h("button", { class: "ghost small", onclick: () => { R = saveR; collectionView(); } }, "← 图鉴"), h("div", { class: "t" }, a.title)), ...paras);
  const hit = document.querySelector(".hz.new");
  if (hit) hit.closest(".para").scrollIntoView({ block: "center" });
  R.taps = [];
}

async function collectionView() {
  const c = await api("GET", "/api/collection");
  const count = (s) => c.cards.filter((x) => x.status === s).length;
  showWide(h("div", { class: "reader-head" }, h("button", { class: "ghost small", onclick: boot }, "← 回家"), h("div", { class: "t" }, "生字图鉴")),
    h("div", { class: "legend" },
      h("span", {}, `🏅 已驯服 ${count("mastered")}`), h("span", {}, `💙 认识 ${count("familiar")}`), h("span", {}, `👀 见过 ${count("seen")}`)),
    c.medals.length ? h("div", { class: "card" }, h("b", {}, "我的勋章 "), ...c.medals.map((m) => h("span", { class: "medal" }, "🏅 ", m.title))) : null,
    c.cards.length
      ? h("div", { class: "cards" }, ...c.cards.map((x) => h("div", { class: `ccard tile ${x.status}`, onclick: () => charModal(x.char) },
          h("div", { class: "big" }, x.char), h("div", { class: "py" }, x.pinyin || ""),
          h("div", { class: "tag" }, x.from ? `来自《${x.from}》` : ""))))
      : h("div", { class: "card center" }, h("p", {}, "图鉴还是空的。读完第一篇故事，生字卡就会出现在这里！")));
}

function mapView() {
  const H = state.home;
  const regions = ["拼音草原", "汉字森林", "成语山谷", "神话之河", "故事城堡", "科学港湾", "诗词云岛", "智慧高塔"];
  showWide(h("div", { class: "reader-head" }, h("button", { class: "ghost small", onclick: boot }, "← 回家"), h("div", { class: "t" }, "闯关地图")),
    h("div", { class: "duo" }, ...regions.map((name, r) => {
      const lit = Math.max(0, Math.min(H.map.perRegion, H.completed - r * H.map.perRegion));
      const strip = h("div", { class: "map-strip" });
      for (let i = 0; i < H.map.perRegion; i++) {
        if (i) strip.append(h("div", { class: "path" + (i < lit ? " lit" : "") }));
        strip.append(h("div", { class: "node" + (i < lit ? " lit" : "") + (r === H.map.regionIndex && i === H.map.node ? " here" : "") }, i < lit ? "★" : ""));
      }
      return h("div", { class: "card region" + (r > H.map.regionIndex ? " locked" : "") },
        h("h3", {}, (r > H.map.regionIndex ? "🔒 " : r < H.map.regionIndex ? "✅ " : "📍 ") + name), strip);
    })));
}

function skillsView() {
  const icons = { extract: "🔎", purpose: "🎯", guess: "🤔", predict: "🔮", locate: "📍", summarise: "🧩", retell: "🎤" };
  showWide(h("div", { class: "reader-head" }, h("button", { class: "ghost small", onclick: boot }, "← 回家"), h("div", { class: "t" }, "技能法宝")),
    h("div", { class: "duo" }, ...state.home.skills.map((s) => h("div", { class: "card skill" + (s.unlocked ? "" : " locked") },
      h("div", { class: "badge" }, icons[s.key] || "⭐"),
      h("div", {}, h("b", {}, s.name), h("div", { class: "muted" }, s.desc),
        h("div", { style: "font-size:15px" }, s.unlocked ? "✅ 已解锁" : `🔒 再通关 ${s.need} 篇解锁`))))));
}

// ================================================================ start
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
(async () => {
  try {
    const me = await (await fetch("/api/me", { credentials: "same-origin" })).json();
    if (!me.role) return loginView();
  } catch {
    // offline: the service worker may still serve the shell; try the app anyway
  }
  boot();
})();
