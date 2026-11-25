// Workers AI calls used by the ingest pipeline. Every model output is
// validated in code and retried; nothing unvalidated reaches the child.
// Set AI_MOCK = "1" (wrangler.toml [env.dev] / .dev.vars) to run the whole
// pipeline locally without an account: outputs are deterministic stubs.
import { paragraphs, isHan, locateSentence, splitSentences, normalise, countHan } from "./text.js";

export const DEFAULT_MODEL = "@cf/qwen/qwen3.8-27b";
// Read-aloud: MeloTTS (the only Workers AI model with Chinese) was retired on
// 2026-11-20; the remaining Aura models are English/Spanish. Server-side audio
// is therefore opt-in via the TTS_MODEL var; the device's Chinese voice reads
// otherwise (offline-capable on iPad).

export const GENRES = ["fable", "fairy", "myth", "story", "science", "history", "poem", "life", "idiom"];
export const GENRE_NAMES = {
  fable: "寓言", fairy: "童话", myth: "神话传说", story: "故事", science: "科普",
  history: "历史", poem: "诗歌", life: "生活", idiom: "成语故事",
};
export const ABILITIES = ["extract", "word", "infer", "summarise", "theme"];
export const ABILITY_NAMES = {
  extract: "信息提取", word: "词语理解", infer: "推断", summarise: "概括", theme: "道理体会", locate: "回文定位", predict: "预测", retell: "复述",
};

/** Workers AI daily allocation used up (error 4006): waiting, not a content problem. */
export function isQuotaError(e) {
  return /\b4006\b|daily free allocation|neurons/i.test(String(e?.message || e));
}

/** UTC day: the Workers AI allocation resets at 00:00 UTC. */
export const utcDay = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);

/** Record one model call (best effort: accounting must never break a call). */
export async function meter(env, purpose, inChars, outChars, failed = false) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(`INSERT INTO ai_usage (day, purpose, calls, in_chars, out_chars, failures) VALUES (?, ?, 1, ?, ?, ?)
      ON CONFLICT(day, purpose) DO UPDATE SET calls = calls + 1, in_chars = in_chars + excluded.in_chars,
        out_chars = out_chars + excluded.out_chars, failures = failures + excluded.failures`)
      .bind(utcDay(), purpose, inChars | 0, outChars | 0, failed ? 1 : 0).run();
  } catch (e) {
    console.warn("[ai] meter failed", e?.message);
  }
}

// ------------------------------------------------------------------ chat
export async function chat(env, prompt, { maxTokens = 1500, temperature = 0.4, retries = 1, purpose = "other" } = {}) {
  const model = env.AI_MODEL || DEFAULT_MODEL;
  const body = {
    messages: [
      { role: "system", content: "你是小学语文老师，为一名四年级学生准备阅读材料。只输出要求的 JSON，不要解释。" },
      { role: "user", content: prompt },
    ],
    max_tokens: maxTokens,
    temperature,
    stream: true,
    chat_template_kwargs: { enable_thinking: false },
  };
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const stream = await env.AI.run(model, body);
      const text = (typeof stream === "object" && stream && typeof stream.getReader === "function"
        ? await readSSE(stream)
        : String(stream?.response ?? stream?.choices?.[0]?.message?.content ?? "")
      ).replace(/<think>[\s\S]*?<\/think>/g, "").trim();
      if (!text) throw new Error(`empty response from ${model}`);
      await meter(env, purpose, prompt.length, text.length);
      return text;
    } catch (e) {
      await meter(env, purpose, prompt.length, 0, true);
      if (isQuotaError(e)) throw e; // retrying only burns time
      lastErr = e;
      console.warn(`[ai] ${model} attempt ${attempt + 1} failed:`, e && (e.stack || e.message || String(e)));
    }
  }
  throw lastErr;
}

async function readSSE(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "", out = "";
  const handle = (line) => {
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    let chunk;
    try { chunk = JSON.parse(payload); } catch { return; }
    // some models send the same text in both shapes: take one
    if (Array.isArray(chunk.choices) && chunk.choices.length) {
      for (const c of chunk.choices) if (typeof c?.delta?.content === "string") out += c.delta.content;
    } else if (typeof chunk.response === "string") out += chunk.response;
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    lines.forEach(handle);
  }
  buffer += decoder.decode();
  buffer.split("\n").forEach(handle);
  return out;
}

/** Pull the first JSON object/array out of model text (tolerates ``` fences). */
export function extractJSON(text) {
  const s = String(text).replace(/```(?:json)?/g, "");
  const start = s.search(/[[{]/);
  if (start < 0) throw new Error("no json in output");
  const open = s[start], close = open === "{" ? "}" : "]";
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return JSON.parse(s.slice(start, i + 1));
  }
  throw new Error("unterminated json");
}

function numbered(body) {
  return paragraphs(body).map((p, i) => `[${i + 1}] ${p}`).join("\n");
}

/** Generate → parse → validate, with one corrective retry. */
async function generate(env, prompt, validate, opts) {
  let lastErr;
  let p = prompt;
  for (let i = 0; i < 2; i++) {
    try {
      const out = extractJSON(await chat(env, p, opts));
      return validate(out);
    } catch (e) {
      if (isQuotaError(e)) throw e;
      lastErr = e;
      p = `${prompt}\n\n上一次输出不合格：${e.message}。请严格按要求的 JSON 格式重新输出。`;
    }
  }
  throw lastErr;
}

// ------------------------------------------------------------------ screen
export function screenPrompt(title, body, interests) {
  return `判断下面这篇文章是否适合一名四年级（约 10 岁）孩子独立阅读。
标题：${title}
正文：
${body.slice(0, 2500)}

要求输出 JSON：
{"age_fit":"ok 或 flagged","reason":"若 flagged，一句话说明原因（如暴力、恐怖、成人内容、价值观问题）；ok 时为空","genre":"从 ${GENRES.join("/")} 中选一个","tags":["2-4 个兴趣标签，如 动物、科学、冒险、搞笑、历史、太空、友情"],"note":"一句话趣味点评，给家长看，30 字以内"}
孩子的兴趣：${(interests || []).join("、") || "未知"}`;
}

export function validateScreen(o) {
  if (!o || typeof o !== "object") throw new Error("not an object");
  const ageFit = o.age_fit === "flagged" ? "flagged" : o.age_fit === "ok" ? "ok" : null;
  if (!ageFit) throw new Error("age_fit must be ok|flagged");
  const genre = GENRES.includes(o.genre) ? o.genre : "story";
  const tags = Array.isArray(o.tags) ? o.tags.filter((t) => typeof t === "string" && t.length <= 8).slice(0, 4) : [];
  return { ageFit, reason: String(o.reason || "").slice(0, 80), genre, tags, note: String(o.note || "").slice(0, 60) };
}

export async function screenArticle(env, { title, body, interests }) {
  if (env.AI_MOCK === "1") return meter(env, "screen", 0, 0).then(() => ({ ageFit: "ok", reason: "", genre: "story", tags: ["模拟"], note: "（模拟评估）" }));
  return generate(env, screenPrompt(title, body, interests), validateScreen, { maxTokens: 300, purpose: "screen" });
}

// ------------------------------------------------------------------ glosses
export function glossPrompt(title, body, chars) {
  return `下面是一篇给四年级孩子读的文章。请为列出的每个字写一张生字卡。
标题：${title}
正文：
${body.slice(0, 3000)}

生字：${chars.join(" ")}

每个字输出：
- word：文中包含这个字的词语（必须是原文里出现的连续文字，2-4 字；若该字单独成词就写这个字）
- gloss：这个字在该词里的意思，用四年级孩子能懂的话，15 字以内
- example：用这个字另造一个简单的句子，15 字以内

输出 JSON 数组：[{"char":"字","word":"词语","gloss":"意思","example":"例句"}]`;
}

export function validateGlosses(arr, body, chars) {
  if (!Array.isArray(arr)) throw new Error("expected array");
  const want = new Set(chars);
  const out = [];
  for (const g of arr) {
    if (!g || !want.has(g.char)) continue;
    let word = String(g.word || "").trim();
    if (!word.includes(g.char) || !body.includes(word) || [...word].length > 6) word = g.char;
    const gloss = String(g.gloss || "").trim().slice(0, 30);
    if (!gloss) continue;
    const example = String(g.example || "").trim().slice(0, 30);
    // an example sentence that does not contain the character teaches nothing
    out.push({ char: g.char, word, gloss, example: example.includes(g.char) ? example : null });
    want.delete(g.char);
  }
  if (out.length < Math.ceil(chars.length * 0.6)) throw new Error(`only ${out.length}/${chars.length} glosses valid`);
  return out;
}

export async function glossChars(env, { title, body, chars }) {
  if (!chars.length) return [];
  if (env.AI_MOCK === "1") {
    await meter(env, "glosses", 0, 0);
    return chars.map((ch) => {
      const i = body.indexOf(ch);
      const next = body[i + 1];
      const word = next && isHan(next) ? ch + next : ch;
      return { char: ch, word, gloss: `“${ch}”的意思（模拟释义）`, example: `这是含有“${ch}”的例句。` };
    });
  }
  return generate(env, glossPrompt(title, body, chars), (o) => validateGlosses(o, body, chars), { maxTokens: 120 + chars.length * 70, purpose: "glosses" });
}

// ------------------------------------------------------------------ questions
export function questionPrompt(title, body, guessChars) {
  return `为下面这篇四年级阅读文章出闯关题。孩子书写能力弱，所有题都是选择题。
标题：${title}
正文（[n] 是段落编号）：
${numbered(body).slice(0, 3200)}

要求输出 JSON：
{
 "purpose": {"task":"读前给孩子的观察任务（带着问题读），一句话，20 字以内，例如：读的时候留意小狐狸想了几个办法","question":{"ability":"extract","prompt":"读完后检查这个任务的题","right":"正确答案","wrong":["错误答案一","错误答案二"],"evidence":答案所在段落编号,"explain":"一句话解析"}},
 "questions": [
   {"ability":"extract","prompt":"题干","right":"正确答案","wrong":["错误答案一","错误答案二"],"evidence":答案所在段落编号（[n] 里的 n）,"explain":"答对后给孩子看的一句话解析"}
 ],
 "guess": {"word":"文中一个含有生字的词语","right":"它在文中的意思","wrong":["错误意思一","错误意思二"],"explain":"一句话说明怎么从上下文猜出来"}
}
规则：
- purpose.question 检查的正是 purpose.task 让孩子留意的内容；
- questions 另出 3 题：信息提取 extract 1 题、推断 infer 1 题、概括或道理 summarise/theme 1 题，按从易到难排列；
- 每题一个正确答案、两个错误答案；错误答案要看起来合理，但能在原文找到否定依据；
- 题干和选项用四年级孩子读得懂的字词，每个选项 20 字以内；
- evidence 必须是真实存在的段落编号；
- guess 的词语从这些字所在的词中选一个：${guessChars.join(" ") || "（任选文中一个较难的词）"}，词语必须原样出现在正文里。`;
}

export function validateQuestions(o, body) {
  const paras = paragraphs(body);
  if (!o || !Array.isArray(o.questions)) throw new Error("questions missing");
  let seed = [...body].length;
  const questions = [];
  // the pre-reading task and the question checking it come as one object: no linking by index
  const pq = o.purpose && typeof o.purpose === "object" ? o.purpose.question : null;
  const list = [...(pq ? [{ ...pq, task: true }] : []), ...o.questions.slice(0, 4)];
  let taskIndex = -1;
  list.slice(0, 5).forEach((q, i) => {
    const prompt = String(q.prompt || "").trim();
    if (!prompt || [...prompt].length > 60) throw new Error(`q${i}: bad prompt`);
    const ability = ABILITIES.includes(q.ability) ? q.ability : "extract";
    const { options, answer } = placeChoice(q.right, q.wrong, seed++, `q${i}`);
    let evidence = Number(q.evidence);
    evidence = Number.isInteger(evidence) && evidence >= 1 && evidence <= paras.length ? evidence - 1 : null;
    if (q.task === true && taskIndex < 0) taskIndex = questions.length;
    questions.push({ kind: "choice", ability, prompt, options, answer, evidence, explain: String(q.explain || "").slice(0, 80) });
  });
  if (questions.length < 3) throw new Error("need at least 3 questions");
  const task = o.purpose?.task;
  const purpose = task && taskIndex >= 0 ? { task: String(task).slice(0, 40), q: taskIndex } : null;
  let guess = null;
  if (o.guess && o.guess.word && body.includes(String(o.guess.word))) {
    try {
      const { options, answer } = placeChoice(o.guess.right, o.guess.wrong, seed++, "guess");
      const word = String(o.guess.word);
      const para = paras.findIndex((p) => p.includes(word));
      guess = { kind: "guess", ability: "word", prompt: `猜一猜：“${word}”在这里是什么意思？`, word, options, answer, evidence: para, explain: String(o.guess.explain || "").slice(0, 80) };
    } catch { guess = null; }
  }
  return { purpose, questions, guess };
}

/**
 * Options from the right text and two wrong ones; code decides the position.
 * Asking a model for an answer index failed in practice (0- vs 1-based
 * numbering mixed within one response), so no model ever returns an index.
 */
export function placeChoice(right, wrongs, seed, where = "choice") {
  const r = String(right ?? "").trim();
  const w = (Array.isArray(wrongs) ? wrongs : []).map((v) => String(v).trim()).slice(0, 2);
  const opts = [r, ...w];
  if (w.length !== 2 || opts.some((v) => !v || [...v].length > 30) || new Set(opts).size !== 3) throw new Error(`${where}: need one right text and two different wrong ones`);
  const answer = Math.abs(seed) % 3;
  const placed = [...w];
  placed.splice(answer, 0, r);
  return { options: placed, answer };
}

export async function makeQuestions(env, { title, body, guessChars }) {
  if (env.AI_MOCK === "1") return meter(env, "questions", 0, 0).then(() => mockQuestions(body, guessChars));
  return generate(env, questionPrompt(title, body, guessChars), (o) => validateQuestions(o, body), { maxTokens: 1600, purpose: "questions" });
}

function mockQuestions(body, guessChars) {
  const paras = paragraphs(body);
  const o = {
    purpose: { task: "（模拟）读的时候留意每段开头的字", question: null },
    questions: paras.slice(0, 4).map((p, i) => ({
      ability: ["extract", "extract", "infer", "summarise"][i],
      prompt: `（模拟题）第 ${i + 1} 段开头的两个字是什么？`,
      right: [...p].filter(isHan).slice(0, 2).join(""), wrong: ["小狗", "月亮"].filter((x) => !p.startsWith(x)).concat(["星星"]).slice(0, 2),
      evidence: i + 1, explain: "（模拟解析）回到这一段开头看看。",
    })),
    guess: null,
  };
  o.purpose.question = o.questions.shift();
  const ch = guessChars[0];
  if (ch) {
    const i = body.indexOf(ch);
    const word = body[i + 1] && isHan(body[i + 1]) ? ch + body[i + 1] : ch;
    o.guess = { word, right: "（模拟）正确意思", wrong: ["（模拟）错误意思一", "（模拟）错误意思二"], explain: "（模拟）联系前后文就能猜到。" };
  }
  return validateQuestions(o, body);
}

// ------------------------------------------------------------------ phase-2 skills
/** Genres with a plot to predict. */
export const NARRATIVE = new Set(["fable", "fairy", "myth", "story", "idiom", "life"]);

export function skillsPrompt(title, body, narrative) {
  return `为下面这篇四年级阅读文章设计三种阅读技能训练。孩子书写能力弱，全部用选择或点选。
标题：${title}
正文（[n] 是段落编号）：
${numbered(body).slice(0, 3400)}

输出 JSON：
{
 "predict": ${narrative ? `{"after": 读完第几段停下来预测（选情节转折之前，不要选最后两段）, "prompt": "猜一猜：接下来会怎样？（一句话，20 字以内，结合当时情节）", "happens": "后文实际发生的走向，20 字以内", "alternatives": ["另外两个也说得通、但没有发生的走向，每个 20 字以内"], "reveal": 在第几段揭晓, "explain": "揭晓时的一句话"}` : "null"},
 "locate": [{"prompt": "一道推断题，答案需要回原文找依据，题干 30 字以内", "evidence": "原文中能证明答案的那一句话，必须一字不差地从正文复制，10-40 字", "answer_text": "答案，一句话"}],
 "sections": [{"from": 起始段号, "to": 结束段号, "summary": "准确概括这部分的一句话，20 字以内", "distractors": ["两个不准确的概括（可以是别的部分的内容，或只说了一个细节），每个 20 字以内"]}],
 "points": ["复述这篇文章时应该讲到的 3–5 个要点，按文章顺序，每个 15 字以内"]
}
规则：
- locate 出 1–2 题，题干是一个具体的问题（如“阿嗅为什么……？”），不要出“哪种说法正确”这类离开选项就答不了的题；evidence 必须是正文原句；
- sections 把全文按内容分成 3–5 部分，按顺序覆盖第 1 段到最后一段，不重叠、不遗漏；
- 用四年级孩子读得懂的字词。`;
}

export function validateSkills(o, body, narrative) {
  const paras = paragraphs(body);
  const n = paras.length;
  if (!o || typeof o !== "object") throw new Error("expected object");
  let seed = [...body].length + 7;
  const choice = (right, wrongs, where) => placeChoice(right, wrongs, seed++, where);
  const out = [];
  // predict: optional, narrative only
  if (narrative && o.predict) {
    try {
      const p = o.predict;
      const after = Number(p.after) - 1, reveal = Number(p.reveal) - 1;
      if (!(after >= 1 && after <= n - 3 && reveal > after && reveal < n)) throw new Error("predict: bad positions");
      const { options, answer } = choice(p.happens, p.alternatives, "predict");
      out.push({ kind: "predict", ability: "predict", prompt: String(p.prompt || "猜一猜：接下来会怎样？").slice(0, 40), options, answer,
        evidence: reveal, explain: String(p.explain || "").slice(0, 80), meta: { after, reveal } });
    } catch { /* a bad prediction is dropped, not fatal */ }
  }
  // locate: evidence must be a real sentence
  for (const l of Array.isArray(o.locate) ? o.locate.slice(0, 2) : []) {
    const at = locateSentence(paras, l.evidence);
    const prompt = String(l.prompt || "").trim();
    if (!at || !prompt || [...prompt].length > 50) continue;
    out.push({ kind: "locate", ability: "locate", prompt, options: splitSentences(paras[at.para]), answer: at.para * 100 + at.sentence,
      evidence: at.para, explain: String(l.answer_text || "").slice(0, 60), meta: at });
  }
  // sections: contiguous cover of 1..n
  const secs = Array.isArray(o.sections) ? o.sections : [];
  if (secs.length < Math.min(3, n) || secs.length > 5) throw new Error("sections: need 3-5");
  let next = 0;
  const built = secs.map((x, i) => {
    const from = Number(x.from) - 1, to = Number(x.to) - 1;
    if (from !== next || to < from || to >= n) throw new Error(`sections: section ${i + 1} does not continue at paragraph ${next + 1}`);
    next = to + 1;
    const { options, answer } = choice(x.summary, x.distractors, `section${i}`);
    return { kind: "section", ability: "summarise", prompt: `第 ${from + 1}${to > from ? `–${to + 1}` : ""} 段主要说什么？`, options, answer, evidence: from, explain: null, meta: { from, to } };
  });
  if (next !== n) throw new Error("sections: must cover every paragraph");
  // retelling key points: optional (no retelling for this article if missing)
  const points = (Array.isArray(o.points) ? o.points : []).map((x) => String(x).trim()).filter((x) => x && [...x].length <= 24);
  if (points.length >= 3) {
    built.push({ kind: "retell", ability: "retell", prompt: "用自己的话讲一讲这篇文章", options: points.slice(0, 5), answer: 0, evidence: null, explain: null, meta: {} });
  }
  if (!out.some((x) => x.kind === "locate")) throw new Error("locate: evidence must be copied exactly from the text");
  return [...out, ...built];
}

export async function makeSkills(env, { title, body, genre }) {
  const narrative = NARRATIVE.has(genre);
  if (env.AI_MOCK === "1") return meter(env, "skills", 0, 0).then(() => mockSkills(body, narrative));
  return generate(env, skillsPrompt(title, body, narrative), (o) => validateSkills(o, body, narrative), { maxTokens: 1500, purpose: "skills" });
}

function mockSkills(body, narrative) {
  const paras = paragraphs(body);
  const n = paras.length;
  const first = splitSentences(paras[1] || paras[0])[0];
  const third = Math.max(1, Math.floor(n / 3));
  const o = {
    predict: narrative ? { after: 2, prompt: "（模拟）猜一猜：接下来会怎样？", happens: "（模拟）实际走向", alternatives: ["（模拟）走向二", "（模拟）走向三"], reveal: 4, explain: "（模拟）揭晓" } : null,
    locate: [{ prompt: "（模拟）哪句话说明了第 2 段的意思？", evidence: first, answer_text: "（模拟）就是这一句" }],
    sections: [
      { from: 1, to: third, summary: "（模拟）开头部分", distractors: ["（模拟）错误一", "（模拟）错误二"] },
      { from: third + 1, to: third * 2, summary: "（模拟）中间部分", distractors: ["（模拟）错误一", "（模拟）错误二"] },
      { from: third * 2 + 1, to: n, summary: "（模拟）结尾部分", distractors: ["（模拟）错误一", "（模拟）错误二"] },
    ],
    points: ["（模拟）要点一", "（模拟）要点二", "（模拟）要点三"],
  };
  return validateSkills(o, body, narrative);
}

// ------------------------------------------------------------------ generated stories (§11)
const FOCUS_HINT = {
  extract: "故事里写清楚具体的时间、地点、数量和先后顺序",
  infer: "情节里留一些线索，让读者能推断出人物的想法或原因，但不要直接说破",
  summarise: "结构清楚，分成开头、经过、结尾几个部分，每部分有一个中心",
  theme: "故事最后自然地让人体会到一个道理，不要说教",
  word: "用上几个可以联系上下文猜出意思的词语",
  locate: "关键的原因或证据要明确写在某一句话里",
};

export function storyPrompt(spec) {
  const hero = spec.hero
    ? `主人公就是读这篇故事的孩子：名字叫${spec.hero.name}${spec.hero.traits ? `，${spec.hero.traits}` : ""}${spec.hero.friends ? `；好朋友：${spec.hero.friends}` : ""}。`
    : "主人公自拟（适合十岁孩子喜欢的角色）。";
  return `请写一篇给四年级孩子（识字量偏少）读的${GENRE_NAMES[spec.genre] || "故事"}。
${hero}
${spec.theme ? `主题：${spec.theme}。` : ""}
要求：
- 正文 600–800 字，分 6–10 段；句子短一些，多用对话和动作；
- 用字尽量简单，以小学一、二年级学过的常用字为主，不用生僻字和成语堆砌；
- 必须自然地用上这些字，每个至少出现两次：${spec.targets.join("、") || "（无）"}；
- ${FOCUS_HINT[spec.focus] || "情节有起伏，有趣味"}；
- 内容积极健康，没有暴力和恐怖情节。
输出格式：第一行是标题（10 字以内），从第二行起是正文，每段一行。不要输出任何其他说明。`;
}

export function rewritePrompt(title, body, hardChars, len) {
  return `下面这篇给四年级孩子的故事里，有些字孩子还不认识：${hardChars.join("、")}。
请改写这些地方，换成更简单的说法（意思不变），其余内容尽量保留。${len < 600 ? "正文太短，请补充到 600–800 字。" : len > 900 ? "正文太长，请删减到 600–800 字。" : "正文保持 600–800 字。"}
输出格式同原文：第一行标题，从第二行起是正文，每段一行，不要其他说明。

${title}
${body}`;
}

/** First line = title; the rest = body (paragraphs, normalised). */
export function parseStory(text) {
  const lines = normalise(String(text).replace(/^#+\s*/gm, "").replace(/\*\*/g, "")).split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 4) throw new Error("story too short");
  const title = lines[0].replace(/^《|》$|^标题[:：]\s*/g, "").slice(0, 20);
  return { title, body: lines.slice(1).join("\n") };
}

export async function writeStory(env, spec) {
  if (env.AI_MOCK === "1") return meter(env, "story", 0, 0).then(() => mockStory(spec));
  return parseStory(await chat(env, storyPrompt(spec), { maxTokens: 2200, temperature: 0.8, purpose: "story" }));
}

export async function rewriteStory(env, story, hardChars, len) {
  if (env.AI_MOCK === "1") {
    await meter(env, "story", 0, 0);
    // mock: drop the offending characters
    const strip = (t) => [...t].filter((c) => !hardChars.includes(c)).join("");
    return { title: story.title, body: strip(story.body) };
  }
  return parseStory(await chat(env, rewritePrompt(story.title, story.body, hardChars, len), { maxTokens: 2200, temperature: 0.4, purpose: "story" }));
}

function mockStory(spec) {
  const name = spec.hero?.name || "小明";
  const t = spec.targets.join("") || "书";
  const paras = [
    `${name}今天起得很早，他想去公园看一看。天上有白白的云，地上有绿绿的草。`,
    `走到半路，${name}看见一只小狗在路边叫。小狗的家在哪里呢？${name}想帮它找到家。`,
    `他问了卖花的阿姨，又问了开车的叔叔。大家都说，小狗是从学校那边跑来的。（模拟生字：${t}${t}）`,
    `${name}带着小狗走到学校门口。门口的老爷爷笑着说：“这是我家的小狗，谢谢你！”`,
    `老爷爷请${name}喝了一杯水，还给他讲了一个有趣的故事。${name}听得很开心。`,
    `回家的路上，${name}想：帮助别人，自己也会很快乐。他决定明天再去看看小狗。`,
    `晚上，${name}把今天的事讲给妈妈听。妈妈说：“你做了一件好事，真棒！”`,
  ];
  return { title: `${name}和小狗`, body: [...paras, ...paras.map((p) => p.replace(/今天|明天/g, "这天"))].join("\n") };
}

// ------------------------------------------------------------------ retelling (live, once or twice a day)
/** Speech → simplified text. Whisper writes traditional characters; normalise. */
export async function transcribe(env, bytes) {
  if (env.AI_MOCK === "1") return meter(env, "stt", 0, 0).then(() => "（模拟转写）我讲了要点一、要点二，还有要点三。");
  const models = [env.STT_MODEL || "@cf/openai/whisper", "@cf/openai/whisper-large-v3-turbo"];
  let lastErr;
  for (const model of [...new Set(models)]) {
    try {
      let input;
      if (model.includes("large-v3")) {
        let bin = "";
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        input = { audio: btoa(bin), language: "zh" };
      } else input = { audio: [...bytes] };
      const r = await env.AI.run(model, input);
      const text = normalise(String(r?.text || "")).replace(/\n/g, "");
      await meter(env, "stt", bytes.length, text.length);
      return text;
    } catch (e) {
      await meter(env, "stt", bytes.length, 0, true);
      if (isQuotaError(e)) throw e;
      lastErr = e;
      console.warn(`[stt] ${model} failed:`, e?.message || e);
    }
  }
  throw lastErr;
}

export function retellPrompt(title, points, transcript) {
  return `一个四年级孩子读完《${title}》后，用自己的话复述了一遍。下面是语音转写，可能有同音错字（如“阿秀”其实是“阿嗅”），请按意思判断，不要按字面。
转写：${transcript.slice(0, 800)}

这篇文章的复述要点：
${points.map((p) => `- ${p}`).join("\n")}

输出 JSON：
{"covered": ["孩子讲到了的要点，从上面的列表里一字不差地抄写"], "feedback": "一句具体的鼓励，提到孩子讲得好的地方，20 字以内", "tip": "下次可以补充的一点，20 字以内；全部讲到则为空字符串"}`;
}

/** covered must be copied from the list: match by text, never by index. */
export function validateRetell(o, points) {
  if (!o || typeof o !== "object") throw new Error("expected object");
  const said = (Array.isArray(o.covered) ? o.covered : []).map((x) => String(x).trim());
  const covered = points.filter((p) => said.some((x) => x === p || x.includes(p) || (x.length >= 4 && p.includes(x))));
  return { covered, feedback: String(o.feedback || "讲得真不错！").slice(0, 40), tip: String(o.tip || "").slice(0, 40) };
}

export async function assessRetell(env, { title, points, transcript }) {
  if (env.AI_MOCK === "1") return meter(env, "retell", 0, 0).then(() => ({ covered: points.slice(), feedback: "（模拟）讲得很完整！", tip: "" }));
  return generate(env, retellPrompt(title, points, transcript), (o) => validateRetell(o, points), { maxTokens: 400, temperature: 0.2, purpose: "retell" });
}

// ------------------------------------------------------------------ polyphones
export function polyphonePrompt(items) {
  return `下面每一行是一句话，其中用【】标出了一个多音字。请根据上下文判断【】里这个字在这里的正确读音（只能从候选里选）。
${items.map((it, i) => `[${i}] ……${it.context}……  候选：${it.candidates.join(" / ")}`).join("\n")}

输出 JSON 对象，键是行号，值是读音（带声调），例如 {"0":"zhǎng","1":"huán"}。`;
}

const toneless = (py) => py.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/u\u0308|ü/g, "v");
const hasTone = (py) => toneless(py) !== py.normalize("NFD").replace(/u\u0308/g, "v");

/**
 * Keep only answers that are one of the candidates. A neutral tone from
 * pinyin-pro (喜欢 xǐ huan, 奶奶 nǎi nai) is kept even if the model offers the
 * citation tone of the same syllable: textbooks mark these words neutral.
 */
export function validatePolyphones(o, items) {
  if (!o || typeof o !== "object") throw new Error("expected object");
  const out = {};
  items.forEach((it, i) => {
    const v = String(o[i] ?? o[String(i)] ?? "").trim();
    if (!it.candidates.includes(v)) return;
    if (it.reading && !hasTone(it.reading) && toneless(v) === toneless(it.reading)) return;
    out[i] = v;
  });
  return out;
}

export async function checkPolyphones(env, items) {
  if (!items.length) return {};
  if (env.AI_MOCK === "1") return meter(env, "polyphones", 0, 0).then(() => ({}));
  return generate(env, polyphonePrompt(items), (o) => validatePolyphones(o, items), { maxTokens: 60 + items.length * 14, temperature: 0.1, purpose: "polyphones" });
}

// ------------------------------------------------------------------ TTS
/** TTS_MODEL → mp3 bytes. Returns null when not configured (client uses the device voice). */
export async function tts(env, text) {
  if (env.AI_MOCK === "1" || !env.AI || !env.TTS_MODEL) return null;
  const res = await env.AI.run(env.TTS_MODEL, { prompt: text, lang: "zh" });
  const b64 = res && (res.audio || res.result?.audio);
  if (!b64) return null;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
