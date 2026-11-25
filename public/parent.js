// 字游记 — parent console.
const $app = document.getElementById("app");
const GENRES = { fable: "寓言", fairy: "童话", myth: "神话传说", story: "故事", science: "科普", history: "历史", poem: "诗歌", life: "生活", idiom: "成语故事" };
const STATUS = { queued: "排队中", processing: "处理中", flagged: "待复核", ready: "已就绪", rejected: "未通过", retired: "已下架" };
const LEVEL = ["已打开", "读完正文", "完成今日阅读", "完成复述"];

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
const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const kid of kids.flat()) if (kid != null) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
};
function toast(msg, ms = 2400) {
  const t = h("div", { class: "toast" }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}
async function api(method, path, body) {
  const headers = { "x-rh-area": "parent" };
  if (body) headers["content-type"] = "application/json";
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) {
    loginView();
    throw new Error("login");
  }
  if (!res.ok) throw new Error(data.error || `出错了（${res.status}）`);
  return data;
}
const pct = (x) => (x == null ? "—" : `${Math.round(x * 100)}%`);

// ================================================================ shell
const TABS = [["report", "报告"], ["library", "书库"], ["add", "添加文章"], ["chars", "生字"], ["settings", "设置"], ["rewards", "奖励"], ["passport", "阅读护照"]];
let tab = location.hash.slice(1) || "report";

function frame(content) {
  $app.replaceChildren(
    h("div", { class: "topbar" }, h("h1", {}, "字游记 · 家长"), h("div", { class: "spacer" }),
      h("a", { class: "btn ghost", href: "/", style: "font-size:15px;min-height:40px" }, "孩子端"),
      h("button", { class: "ghost small", onclick: async () => { await api("POST", "/api/logout", { role: "parent" }); loginView(); } }, "退出")),
    h("div", { class: "tabs" }, ...TABS.map(([k, label]) => h("button", { class: k === tab ? "on" : "", onclick: () => go(k) }, label))),
    content);
}
function go(k) {
  tab = k;
  location.hash = k;
  render();
}
async function render() {
  frame(h("p", { class: "muted" }, "加载中……"));
  try {
    frame(await VIEWS[tab]());
  } catch (e) {
    if (e.message !== "login") frame(h("div", { class: "card" }, "出错：", e.message));
  }
}

function loginView() {
  const input = h("input", { type: "password", inputmode: "numeric", placeholder: "家长密码", autofocus: true });
  const err = h("div", { class: "err" });
  const submit = async () => {
    const res = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin: input.value }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return (err.textContent = d.error || "登录失败");
    if (d.role !== "parent") return (err.textContent = "这是孩子的密码，请输入家长密码");
    render();
  };
  input.addEventListener("keydown", (e) => e.key === "Enter" && submit());
  $app.replaceChildren(h("div", { class: "card", style: "max-width:380px;margin:12vh auto" },
    h("h2", {}, "家长入口"), input, err, h("button", { onclick: submit, style: "margin-top:10px;width:100%" }, "进入")));
}

// ================================================================ charts
function radarChart(items) {
  const n = items.length, cx = 150, cy = 140, R = 100;
  const pt = (i, r) => [cx + r * Math.sin((2 * Math.PI * i) / n), cy - r * Math.cos((2 * Math.PI * i) / n)];
  const g = svg("svg", { viewBox: "0 0 300 280", width: "100%", style: "max-width:340px" });
  for (const f of [0.25, 0.5, 0.75, 1]) g.append(svg("polygon", { points: items.map((_, i) => pt(i, R * f).join(",")).join(" "), fill: "none", stroke: "var(--line)" }));
  items.forEach((it, i) => {
    const [x, y] = pt(i, R + 22);
    g.append(svg("line", { x1: cx, y1: cy, x2: pt(i, R)[0], y2: pt(i, R)[1], stroke: "var(--line)" }));
    g.append(svg("text", { x, y, "text-anchor": "middle", "dominant-baseline": "middle" }, `${it.name} ${it.rate == null ? "—" : it.rate + "%"}`));
  });
  const pts = items.map((it, i) => pt(i, (R * (it.rate ?? 0)) / 100).join(",")).join(" ");
  g.append(svg("polygon", { points: pts, fill: "rgba(224,122,63,.25)", stroke: "var(--accent)", "stroke-width": 2 }));
  return g;
}

function lineChart(rows) {
  const W = 600, H = 200, P = 34;
  const g = svg("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%" });
  if (rows.length < 1) return h("p", { class: "muted" }, "还没有数据。");
  const max = Math.max(...rows.map((r) => r.known), 100);
  const min = Math.min(...rows.map((r) => r.known));
  const lo = Math.max(0, Math.floor((min - 50) / 100) * 100);
  const x = (i) => P + (rows.length === 1 ? (W - 2 * P) / 2 : (i * (W - 2 * P)) / (rows.length - 1));
  const y = (v) => H - P - ((v - lo) / Math.max(1, max - lo)) * (H - 2 * P);
  for (const v of [lo, Math.round((lo + max) / 2), max]) {
    g.append(svg("line", { x1: P, x2: W - P, y1: y(v), y2: y(v), stroke: "var(--line)" }));
    g.append(svg("text", { x: 2, y: y(v) + 4 }, v));
  }
  g.append(svg("polyline", { points: rows.map((r, i) => `${x(i)},${y(r.known)}`).join(" "), fill: "none", stroke: "var(--accent)", "stroke-width": 2.5 }));
  rows.forEach((r, i) => g.append(svg("circle", { cx: x(i), cy: y(r.known), r: 3, fill: "var(--accent)" }, svg("title", {}, `${r.date}：认识 ${r.known}，掌握 ${r.mastered}`))));
  g.append(svg("text", { x: P, y: H - 8 }, rows[0].date));
  if (rows.length > 1) g.append(svg("text", { x: W - P, y: H - 8, "text-anchor": "end" }, rows[rows.length - 1].date));
  return g;
}

// ================================================================ views
const VIEWS = {
  async report() {
    const r = await api("GET", "/api/parent/report");
    const last = r.curve[r.curve.length - 1];
    return h("div", {},
      h("div", { class: "kpi" },
        h("div", { class: "stat" }, h("b", {}, r.streak), h("span", {}, "连续天数")),
        h("div", { class: "stat" }, h("b", {}, `${r.weekDone}/7`), h("span", {}, "近 7 天完成")),
        h("div", { class: "stat" }, h("b", {}, last ? last.known : "—"), h("span", {}, "认识的字")),
        h("div", { class: "stat" }, h("b", {}, r.dueReview), h("span", {}, "待复习生字"))),
      h("div", { class: "card", style: "margin-top:16px" }, h("h2", {}, "建议"), h("ul", {}, ...r.suggestion.map((s) => h("li", {}, s)))),
      h("div", { class: "grid2" },
        h("div", { class: "card" }, h("h2", {}, "能力雷达（近 60 天首答正确率）"), radarChart(r.radar),
          h("p", { class: "muted", style: "font-size:14px" }, r.radar.map((x) => `${x.name} ${x.correct}/${x.total}`).join(" · "))),
        h("div", { class: "card" }, h("h2", {}, "识字量曲线"), lineChart(r.curve),
          r.assessment ? h("p", { class: "muted", style: "font-size:14px" }, `测评估计：${r.assessment.estimate} 字，约到统编版${r.assessment.reached}（${r.assessment.at.slice(0, 10)}）`) : null,
          h("h3", {}, `本月新驯服 ${r.newMastered.length} 个`),
          h("div", { class: "chars-inline" }, r.newMastered.map((c) => c.char).join("") || "—"))),
      h("div", { class: "card" }, h("h2", {}, "阅读履历"),
        r.history.length ? h("table", {},
          h("tr", {}, ...["日期", "文章", "状态", "用时", "速度", "点读", "首答正确率", "生字", "骨头"].map((x) => h("th", {}, x))),
          ...r.history.flatMap((s) => {
            const v = s.verdict;
            const row = h("tr", {},
              h("td", {}, s.date, s.daily ? "" : h("span", { class: "pill" }, "加读")),
              h("td", {}, s.title, h("div", { class: "muted", style: "font-size:13px" }, `${s.genre || ""} ${s.chars} 字`)),
              h("td", {}, LEVEL[s.level], v?.recovered ? h("div", { class: "muted", style: "font-size:13px" }, "回看后答对") : null, v?.tooFast ? h("div", { class: "muted", style: "font-size:13px" }, "⚠ 读得偏快") : null),
              h("td", {}, `${s.minutes} 分`),
              h("td", {}, v?.speed ? `${v.speed} 字/分` : "—"),
              h("td", {}, s.taps, s.tapped ? h("div", { class: "muted", style: "font-size:13px" }, s.tapped) : null),
              h("td", {}, pct(s.accuracy)),
              h("td", {}, s.charTotal ? `${v?.charFirstOk ?? s.charOk}/${s.charTotal}` : "—",
                v && v.charFirstOk != null && s.charOk > v.charFirstOk ? h("div", { class: "muted", style: "font-size:13px" }, `再见一面后 ${s.charOk}/${s.charTotal}`) : null),
              h("td", {}, s.bones || 0));
            const rows = [row];
            if (s.wrong.length) rows.push(h("tr", {}, h("td", {}), h("td", { colspan: 8 }, h("details", {}, h("summary", { class: "muted" }, `错题 ${s.wrong.length}`),
              ...s.wrong.map((w) => h("div", { style: "margin:6px 0" }, h("span", { class: "pill" }, w.ability), ` ${w.prompt}（第 ${w.attempt} 次）选了「${w.chose}」，正确是「${w.right}」`))))));
            return rows;
          })) : h("p", { class: "muted" }, "还没有阅读记录。")));
  },

  async library() {
    const status = new URLSearchParams(location.search).get("status") || "";
    const d = await api("GET", "/api/parent/articles" + (status ? `?status=${status}` : ""));
    const pending = (d.counts.queued || 0) + (d.counts.processing || 0);
    const runBtn = h("button", { class: "small", onclick: () => runPipeline(runBtn) }, `立即处理队列（${pending}）`);
    const filter = h("div", { class: "row" }, ...[["", "全部"], ...Object.entries(STATUS)].map(([k, label]) =>
      h("button", { class: "small " + (k === status ? "" : "ghost"), onclick: () => { history.replaceState(null, "", `?status=${k}#library`); render(); } }, `${label}${k && d.counts[k] ? ` ${d.counts[k]}` : ""}`)));
    return h("div", {},
      h("div", { class: "card" }, h("div", { class: "row" }, filter, h("span", { class: "spacer" }), pending ? runBtn : null),
        h("p", { class: "muted", style: "font-size:14px" }, "入库流程：硬指标（覆盖率、句长、字数）→ AI 适龄评估 → 拼音 → 生字卡 → 出题 → 朗读音频。定时任务每 30 分钟自动处理一次。")),
      h("div", { class: "card" }, d.articles.length ? h("table", {},
        h("tr", {}, ...["#", "标题", "状态", "字数", "难度", "覆盖率", "点评 / 原因"].map((x) => h("th", {}, x))),
        ...d.articles.map((a) => h("tr", { style: "cursor:pointer", onclick: () => articleView(a.id) },
          h("td", {}, a.id), h("td", {}, a.title, h("div", { class: "muted", style: "font-size:13px" }, a.genreName || "")),
          h("td", {}, h("span", { class: `pill ${a.status}` }, STATUS[a.status]), a.status === "processing" ? h("div", { class: "muted", style: "font-size:13px" }, a.stage) : null),
          h("td", {}, a.char_count || "—"), h("td", {}, a.difficulty ?? "—"), h("td", {}, pct(a.coverage)),
          h("td", { style: "font-size:14px" }, a.reject_reason || a.ai_note || "", a.last_error ? h("div", { class: "muted" }, a.last_error) : null)))) : h("p", { class: "muted" }, "书库是空的，去“添加文章”放几篇进来吧。")));
  },

  async add() {
    const title = h("input", { placeholder: "标题" });
    const genre = h("select", {}, h("option", { value: "" }, "题材（可留空，AI 判断）"), ...Object.entries(GENRES).map(([k, v]) => h("option", { value: k }, v)));
    const source = h("input", { placeholder: "来源，如：快乐读书吧《中国神话传说》" });
    const body = h("textarea", { placeholder: "正文，一段一行。建议 600–900 字。" });
    const addOne = async () => {
      try {
        const r = await api("POST", "/api/parent/articles", { title: title.value, body: body.value, genre: genre.value, source: source.value });
        toast(r.duplicate ? `已存在（#${r.duplicate}）` : `已加入队列 #${r.id}`);
        if (!r.duplicate) { title.value = ""; body.value = ""; }
      } catch (e) { toast(e.message); }
    };
    const bulk = h("textarea", { placeholder: "=== 第一篇标题\n正文……\n\n=== 第二篇标题\n正文……" });
    const file = h("input", { type: "file", accept: ".txt,text/plain" });
    file.addEventListener("change", async () => { if (file.files[0]) bulk.value = await file.files[0].text(); });
    const bulkSource = h("input", { placeholder: "来源（整批）" });
    const addBulk = async () => {
      try {
        const r = await api("POST", "/api/parent/articles/bulk", { text: bulk.value, source: bulkSource.value });
        toast(`导入 ${r.results.filter((x) => x.id).length} 篇，重复 ${r.results.filter((x) => x.duplicate).length} 篇`);
      } catch (e) { toast(e.message); }
    };
    const wsTitle = h("input", { placeholder: "维基文库页面标题，例如：伊索寓言/狐狸和葡萄" });
    const wsGenre = genre.cloneNode(true);
    const importWs = async () => {
      try {
        const r = await api("POST", "/api/parent/import/wikisource", { title: wsTitle.value, genre: wsGenre.value });
        toast(r.duplicate ? "已存在" : `已加入队列 #${r.id}`);
      } catch (e) { toast(e.message); }
    };
    return h("div", {},
      h("div", { class: "card" }, h("h2", {}, "录入一篇"), h("div", { class: "grid2" }, h("div", {}, h("label", {}, "标题"), title), h("div", {}, h("label", {}, "题材"), genre)),
        h("label", {}, "来源"), source, h("label", {}, "正文"), body, h("div", { class: "row end", style: "margin-top:10px" }, h("button", { onclick: addOne }, "加入书库"))),
      h("div", { class: "card" }, h("h2", {}, "批量导入（txt）"),
        h("p", { class: "muted" }, "每篇以一行“=== 标题”开头。适合自家藏书导出的文本、OCR 结果。"),
        file, h("label", {}, "来源"), bulkSource, h("label", {}, "内容"), bulk, h("div", { class: "row end", style: "margin-top:10px" }, h("button", { onclick: addBulk }, "批量导入"))),
      h("div", { class: "card" }, h("h2", {}, "从维基文库导入（公版）"),
        h("p", { class: "muted" }, "按页面标题抓取一页正文（低频、单页）。繁体会自动转为简体再分析；文言文通常会因句式和用字被淘汰或标为待复核。"),
        h("div", { class: "grid2" }, wsTitle, wsGenre), h("div", { class: "row end", style: "margin-top:10px" }, h("button", { onclick: importWs }, "导入"))),
      h("p", { class: "muted", style: "font-size:14px" }, "资源只进不出：所有文章只存在你的 Cloudflare D1 里，不进代码仓库、不外传。"));
  },

  async chars() {
    const st = new URLSearchParams(location.search).get("cs") || "seen";
    const d = await api("GET", `/api/parent/chars?status=${st}`);
    const tb = await api("GET", "/api/parent/textbook");
    const counts = {};
    for (const c of d.counts) counts[c.status] = (counts[c.status] || 0) + c.n;
    const tbText = h("textarea", { style: "min-height:90px", placeholder: "把课本某单元的生字表粘贴进来（只取汉字）" });
    const unit = h("input", { placeholder: "单元，如：四上第三单元" });
    const markText = h("input", { placeholder: "要标记的字" });
    const markSel = h("select", {}, h("option", { value: "familiar" }, "认识"), h("option", { value: "mastered" }, "已掌握"), h("option", { value: "unknown" }, "不认识（移出已知字表）"));
    return h("div", {},
      h("div", { class: "card" },
        h("div", { class: "row" }, ...["seen", "familiar", "mastered"].map((k) => h("button", { class: "small " + (k === st ? "" : "ghost"), onclick: () => { history.replaceState(null, "", `?cs=${k}#chars`); render(); } },
          `${{ seen: "见过", familiar: "认识", mastered: "掌握" }[k]} ${counts[k] || 0}`)),
          h("span", { class: "spacer" }),
          h("button", { class: "small soft", onclick: async () => { await api("POST", "/api/parent/assessment/request"); toast("孩子下次打开时会重新测评"); } }, "安排重新测评")),
        st === "familiar"
          ? h("p", { class: "muted" }, `其中来自测评推断的 ${d.chars.filter((c) => c.origin === "inferred").length} 个、测评答对 ${d.chars.filter((c) => c.origin === "assessment").length} 个、阅读中学会 ${d.chars.filter((c) => c.origin === "reading").length} 个。`)
          : null,
        st === "familiar"
          ? h("div", { class: "chars-inline" }, d.chars.map((c) => c.char).join(""))
          : h("table", {}, h("tr", {}, ...["字", "拼音", "释义", "首次见到", "下次复习", "答对篇数", "答错"].map((x) => h("th", {}, x))),
              ...d.chars.map((c) => h("tr", {}, h("td", { style: "font-size:22px" }, c.char), h("td", {}, c.pinyin || ""), h("td", {}, c.gloss || ""), h("td", {}, c.first_seen_at || ""), h("td", {}, c.due_at || "—"), h("td", {}, c.correctArticles), h("td", {}, c.lapses))))),
      h("div", { class: "grid2" },
        h("div", { class: "card" }, h("h2", {}, "课本同步生字"),
          h("p", { class: "muted" }, "“正在学”的字会让选文向它们倾斜（提前混脸熟）；“已学会”的字直接计入已知字表。"),
          h("label", {}, "单元"), unit, h("label", {}, "生字"), tbText,
          h("div", { class: "row end", style: "margin-top:10px" },
            h("button", { class: "ghost small", onclick: async () => { try { const r = await api("POST", "/api/parent/textbook", { text: tbText.value, unit: unit.value, mode: "known" }); toast(`已计入已知 ${r.count} 字`); } catch (e) { toast(e.message); } } }, "这些已学会"),
            h("button", { class: "small", onclick: async () => { try { const r = await api("POST", "/api/parent/textbook", { text: tbText.value, unit: unit.value, mode: "upcoming" }); toast(`已加入 ${r.count} 字`); render(); } catch (e) { toast(e.message); } } }, "正在学 / 即将学")),
          tb.chars.length ? h("div", {}, h("h3", {}, `正在学（${tb.chars.length}）`), h("div", { class: "chars-inline" }, tb.chars.map((c) => c.char).join("")),
            h("button", { class: "ghost small", onclick: async () => { await api("DELETE", "/api/parent/textbook"); render(); } }, "清空")) : null),
        h("div", { class: "card" }, h("h2", {}, "手动标记"),
          h("p", { class: "muted" }, "发现测评不准时手动修正。阅读中学到的字不会被“不认识”删掉。"),
          markText, h("div", { style: "margin-top:8px" }, markSel),
          h("div", { class: "row end", style: "margin-top:10px" }, h("button", { onclick: async () => { try { const r = await api("POST", "/api/parent/chars", { chars: markText.value, status: markSel.value }); toast(`已更新 ${r.count} 字`); render(); } catch (e) { toast(e.message); } } }, "保存")))));
  },

  async settings() {
    const s = await api("GET", "/api/parent/settings");
    const f = {};
    const field = (k, label, el, help) => { f[k] = el; return h("div", {}, h("label", {}, label), el, help ? h("div", { class: "muted", style: "font-size:13px" }, help) : null); };
    const num = (v, min, max) => h("input", { type: "number", value: v, min, max });
    const sel = (v, opts) => { const e = h("select", {}, ...opts.map(([k, l]) => h("option", { value: k }, l))); e.value = v; return e; };
    const save = async () => {
      try {
        await api("PUT", "/api/parent/settings", {
          child_name: f.child_name.value.trim(),
          pinyin: f.pinyin.value,
          font_size: Number(f.font_size.value),
          session_min: Number(f.session_min.value),
          rest_min: Number(f.rest_min.value),
          daily_limit_min: Number(f.daily_limit_min.value),
          bedtime: f.bedtime.value,
          wake_time: f.wake_time.value,
          interests: f.interests.value.split(/[,，、\s]+/).filter(Boolean),
          target_new: Number(f.target_new.value),
          skill_days: Number(f.skill_days.value),
          audio: f.audio.value === "1",
        });
        toast("已保存");
      } catch (e) { toast(e.message); }
    };
    return h("div", { class: "card" },
      h("div", { class: "grid2" },
        field("child_name", "孩子的称呼", h("input", { value: s.child_name })),
        field("interests", "兴趣标签", h("input", { value: (s.interests || []).join("、") }), "如：动物、科学、冒险、搞笑、历史——选文会向这些倾斜"),
        field("pinyin", "拼音标注", sel(s.pinyin, [["all", "全文标注（默认）"], ["new", "只标生字"], ["off", "不标（点字才显示）"]]), "拼音是拐杖：熟练后逐步调降"),
        field("font_size", "正文字号（px）", num(s.font_size, 16, 40), "≥18，默认 22"),
        field("target_new", "每篇目标生字数", num(s.target_new, 2, 10), "系统会按正确率自动升降"),
        field("skill_days", "每通关几篇解锁一个技能", num(s.skill_days, 1, 30)),
        field("session_min", "单次阅读时长（分钟）", num(s.session_min, 5, 40), "到时进入休息页"),
        field("rest_min", "休息页锁定（分钟）", num(s.rest_min, 0, 10)),
        field("daily_limit_min", "每日看屏上限（分钟）", num(s.daily_limit_min, 0, 180), "超过后只能听读；0 = 不限"),
        field("audio", "预生成朗读音频", sel(s.audio ? "1" : "0", [["1", "是（需配置 TTS_MODEL，存 R2）"], ["0", "否（用设备语音）"]]), "Workers AI 目前没有中文朗读模型，默认用 iPad 自带中文语音"),
        field("bedtime", "就寝时间", h("input", { type: "time", value: s.bedtime }), "之后只开放听读"),
        field("wake_time", "起床时间", h("input", { type: "time", value: s.wake_time }))),
      h("div", { class: "row end", style: "margin-top:16px" }, h("button", { onclick: save }, "保存设置")));
  },

  async rewards() {
    const d = await api("GET", "/api/parent/ledger");
    const s = await api("GET", "/api/parent/settings");
    const rows = h("div", {});
    const addRow = (r = { bones: 50, item: "" }) => rows.append(h("div", { class: "row", style: "margin-bottom:8px" },
      h("input", { type: "number", value: r.bones, style: "width:110px", "data-k": "bones" }), h("input", { value: r.item, placeholder: "奖励内容", "data-k": "item", style: "flex:1;width:auto" }),
      h("button", { class: "ghost small", onclick: (e) => e.currentTarget.parentElement.remove() }, "删除")));
    (s.rewards || []).forEach(addRow);
    const saveRules = async () => {
      const rewards = [...rows.children].map((r) => ({ bones: Number(r.querySelector('[data-k="bones"]').value), item: r.querySelector('[data-k="item"]').value.trim() })).filter((r) => r.item && r.bones > 0);
      try { await api("PUT", "/api/parent/settings", { rewards }); toast("已保存"); render(); } catch (e) { toast(e.message); }
    };
    return h("div", { class: "grid2" },
      h("div", { class: "card" }, h("h2", {}, `骨头余额：${d.balance} 🦴`),
        h("h3", {}, "兑换"), ...d.rewards.map((r, i) => h("div", { class: "row", style: "margin-bottom:8px" }, h("span", { style: "flex:1" }, `${r.item}`), h("b", {}, `${r.bones} 🦴`),
          h("button", { class: "small", disabled: d.balance < r.bones, onclick: async () => { if (!confirm(`确认兑换「${r.item}」，扣 ${r.bones} 骨头？`)) return; try { await api("POST", "/api/parent/redeem", { index: i }); toast("已兑换"); render(); } catch (e) { toast(e.message); } } }, "兑换"))),
        h("h3", {}, "兑换规则（家长定）"), rows,
        h("div", { class: "row" }, h("button", { class: "ghost small", onclick: () => addRow() }, "+ 添加一条"), h("span", { class: "spacer" }), h("button", { class: "small", onclick: saveRules }, "保存规则"))),
      h("div", { class: "card" }, h("h2", {}, "流水"), h("table", {}, ...d.entries.map((e) => h("tr", {}, h("td", {}, e.at.slice(0, 16)), h("td", {}, e.reason), h("td", { style: `color:${e.amount < 0 ? "var(--accent)" : "var(--good)"}` }, e.amount > 0 ? `+${e.amount}` : e.amount))))));
  },

  async passport() {
    const month = new URLSearchParams(location.search).get("m") || "";
    const p = await api("GET", "/api/parent/passport" + (month ? `?month=${month}` : ""));
    const [y, mo] = p.month.split("-").map(Number);
    const daysIn = new Date(y, mo, 0).getDate();
    const readDays = new Set(p.sessions.map((s) => Number(s.date.slice(8))));
    const pick = h("input", { type: "month", value: p.month, style: "width:auto" });
    pick.addEventListener("change", () => { history.replaceState(null, "", `?m=${pick.value}#passport`); render(); });
    return h("div", {},
      h("div", { class: "row", style: "margin-bottom:12px" }, pick, h("span", { class: "spacer" }), h("button", { onclick: () => print() }, "打印")),
      h("div", { class: "passport" },
        h("h1", {}, "阅读护照"),
        h("p", { style: "text-align:center" }, `${p.childName} · ${y} 年 ${mo} 月`),
        h("p", { style: "text-align:center;font-size:18px" }, `本月读了 ${p.days} 天、${p.sessions.length} 篇、${p.chars} 字；新驯服 ${p.mastered.length} 个生字`),
        h("div", { class: "stamps" }, ...Array.from({ length: daysIn }, (_, i) => h("div", { class: "stamp" + (readDays.has(i + 1) ? " on" : "") }, readDays.has(i + 1) ? "已读" : i + 1))),
        h("h3", {}, "本月新驯服的字"),
        h("div", { class: "chars-inline", style: "font-size:30px" }, p.mastered.map((c) => c.char).join(" ") || "—"),
        p.medals.length ? h("div", {}, h("h3", {}, "本月勋章"), ...p.medals.map((m) => h("span", { class: "medal" }, "🏅 ", m.title))) : null,
        h("h3", {}, "读过的故事"),
        h("ol", {}, ...p.sessions.map((s) => h("li", {}, `${s.date.slice(5)} 《${s.title}》`)))));
  },
};

async function articleView(id) {
  const a = await api("GET", `/api/parent/articles/${id}`);
  const act = async (action, confirmMsg) => {
    if (confirmMsg && !confirm(confirmMsg)) return;
    try { await api("POST", `/api/parent/articles/${id}/${action}`); toast("已完成"); articleView(id); } catch (e) { toast(e.message); }
  };
  const buttons = h("div", { class: "row" });
  if (a.status === "flagged") buttons.append(h("button", { class: "small", onclick: () => act("approve") }, "我看过了，放行"));
  if (a.status === "ready") buttons.append(h("button", { class: "small", onclick: () => act("pick") }, "设为今日一篇"));
  if (a.status === "rejected") buttons.append(h("button", { class: "small", onclick: () => act("force") }, "忽略硬指标，强制入库"));
  buttons.append(h("button", { class: "small ghost", onclick: () => act("requeue") }, "重新处理"));
  if (a.status !== "retired") buttons.append(h("button", { class: "small ghost", onclick: () => act("retire") }, "下架"));
  buttons.append(h("button", { class: "small ghost", onclick: () => act("delete", "永久删除这篇文章？") }, "删除"));
  frame(h("div", {},
    h("button", { class: "ghost small", onclick: () => render() }, "← 返回书库"),
    h("div", { class: "card", style: "margin-top:12px" },
      h("h2", {}, a.title, " ", h("span", { class: `pill ${a.status}` }, STATUS[a.status])),
      h("p", { class: "muted" }, [a.genreName, `${a.char_count} 字`, `难度 ${a.difficulty ?? "—"}`, `覆盖率 ${pct(a.coverage)}`, `平均句长 ${a.avg_sentence_len ?? "—"}`, `最长句 ${a.max_sentence_len ?? "—"}`].filter(Boolean).join(" · ")),
      a.ai_note ? h("p", {}, "AI 点评：", a.ai_note, a.tags.length ? `（${a.tags.join("、")}）` : "") : null,
      a.reject_reason ? h("p", { style: "color:var(--accent)" }, a.reject_reason) : null,
      a.last_error ? h("p", { class: "muted" }, "最近错误：", a.last_error) : null,
      buttons),
    h("div", { class: "grid2" },
      h("div", { class: "card" }, h("h2", {}, "对孩子来说的生字 ",
          h("span", { class: "pill " + ({ pass: "ready", review: "queued", later: "rejected" }[a.tierForChild]) },
            { pass: `合适（${a.newForChild.length} 个）`, review: `偏难（${a.newForChild.length} 个）`, later: `暂缓（${a.newForChild.length} 个，等识字量涨上来）` }[a.tierForChild])),
        h("div", { class: "chars-inline" }, a.newForChild.join("") || "（没有：全都认识）"),
        a.rareForChild.length ? h("p", { class: "muted" }, "生僻字（只给拼音，不作为目标）：", a.rareForChild.join("")) : null,
        h("h3", {}, "生字卡"),
        h("table", {}, ...a.glosses.map((g) => h("tr", {}, h("td", { style: "font-size:22px" }, g.char), h("td", {}, g.pinyin), h("td", {}, g.word), h("td", {}, g.gloss || "—"))))),
      h("div", { class: "card" }, h("h2", {}, "闯关题"),
        a.purpose ? h("p", {}, h("b", {}, "读前任务："), a.purpose.task) : null,
        ...a.questions.map((q) => h("div", { style: "margin-bottom:12px" },
          h("span", { class: "pill" }, q.kind === "guess" ? "猜词义" : q.abilityName), " ", h("b", {}, q.prompt),
          h("ol", { type: "A", style: "margin:4px 0" }, ...q.options.map((o, i) => h("li", { style: i === q.answer ? "color:var(--good);font-weight:600" : "" }, o))),
          q.evidence != null ? h("div", { class: "muted", style: "font-size:13px" }, `依据：第 ${q.evidence + 1} 段`) : null)))),
    h("div", { class: "card" }, h("h2", {}, "正文"), ...a.paragraphs.map((p, i) => h("p", {}, h("span", { class: "muted" }, `[${i + 1}] `), p))),
    a.reads.length ? h("div", { class: "card" }, h("h2", {}, "阅读记录"), ...a.reads.map((r) => h("div", {}, `${r.date} · ${LEVEL[r.level]} · 正确率 ${pct(r.accuracy)} · ${Math.round(r.active_ms / 60000)} 分钟`))) : null));
}

async function runPipeline(btn) {
  btn.disabled = true;
  try {
    for (let i = 0; i < 200; i++) {
      const r = await api("POST", "/api/parent/pipeline/step");
      btn.textContent = `处理中…（剩 ${r.pending}）${r.log ? " " + r.log : ""}`;
      if (!r.pending) break;
    }
  } catch (e) { toast(e.message); }
  render();
}

window.addEventListener("hashchange", () => { tab = location.hash.slice(1) || "report"; render(); });
(async () => {
  const me = await (await fetch("/api/me", { credentials: "same-origin", headers: { "x-rh-area": "parent" } })).json().catch(() => ({}));
  if (me.role !== "parent") return loginView();
  render();
})();
