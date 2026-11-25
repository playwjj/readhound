// Workers AI calls used by the ingest pipeline. Every model output is
// validated in code and retried; nothing unvalidated reaches the child.
// Set AI_MOCK = "1" (wrangler.toml [env.dev] / .dev.vars) to run the whole
// pipeline locally without an account: outputs are deterministic stubs.
import { paragraphs, isHan } from "./text.js";

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
  extract: "信息提取", word: "词语理解", infer: "推断", summarise: "概括", theme: "道理体会", locate: "回文定位",
};

// ------------------------------------------------------------------ chat
export async function chat(env, prompt, { maxTokens = 1500, temperature = 0.4, retries = 1 } = {}) {
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
      return text;
    } catch (e) {
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
  if (env.AI_MOCK === "1") return { ageFit: "ok", reason: "", genre: "story", tags: ["模拟"], note: "（模拟评估）" };
  return generate(env, screenPrompt(title, body, interests), validateScreen, { maxTokens: 300 });
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
    return chars.map((ch) => {
      const i = body.indexOf(ch);
      const next = body[i + 1];
      const word = next && isHan(next) ? ch + next : ch;
      return { char: ch, word, gloss: `“${ch}”的意思（模拟释义）`, example: `这是含有“${ch}”的例句。` };
    });
  }
  return generate(env, glossPrompt(title, body, chars), (o) => validateGlosses(o, body, chars), { maxTokens: 120 + chars.length * 70 });
}

// ------------------------------------------------------------------ questions
export function questionPrompt(title, body, guessChars) {
  return `为下面这篇四年级阅读文章出闯关题。孩子书写能力弱，所有题都是选择题。
标题：${title}
正文（[n] 是段落编号）：
${numbered(body).slice(0, 3200)}

要求输出 JSON：
{
 "purpose": {"task":"读前给孩子的观察任务（带着问题读），一句话，20 字以内，例如：读的时候留意小狐狸想了几个办法","q":对应下面 questions 里哪一题（从 0 开始的序号）},
 "questions": [
   {"ability":"extract","prompt":"题干","options":["选项A","选项B","选项C"],"answer":正确选项序号(0-2),"evidence":答案所在段落编号,"explain":"答对后给孩子看的一句话解析"}
 ],
 "guess": {"word":"文中一个含有生字的词语","options":["意思A","意思B","意思C"],"answer":序号,"explain":"一句话说明怎么从上下文猜出来"}
}
规则：
- questions 共 4 题：信息提取 extract 2 题、推断 infer 1 题、概括或道理 summarise/theme 1 题，按从易到难排列；
- 每题 3 个选项，只有一个正确，干扰项要看起来合理但能在原文找到否定依据；
- 题干和选项用四年级孩子读得懂的字词，每个选项 20 字以内；
- evidence 必须是真实存在的段落编号；
- guess 的词语从这些字所在的词中选一个：${guessChars.join(" ") || "（任选文中一个较难的词）"}，词语必须原样出现在正文里。`;
}

export function validateQuestions(o, body) {
  const paras = paragraphs(body);
  if (!o || !Array.isArray(o.questions)) throw new Error("questions missing");
  const checkChoice = (q, where) => {
    if (!Array.isArray(q.options) || q.options.length < 3 || q.options.length > 4) throw new Error(`${where}: need 3-4 options`);
    const opts = q.options.map((x) => String(x).trim());
    if (opts.some((x) => !x || [...x].length > 30)) throw new Error(`${where}: bad option text`);
    if (new Set(opts).size !== opts.length) throw new Error(`${where}: duplicate options`);
    const answer = Number(q.answer);
    if (!Number.isInteger(answer) || answer < 0 || answer >= opts.length) throw new Error(`${where}: bad answer index`);
    return { options: opts, answer };
  };
  const questions = [];
  o.questions.slice(0, 5).forEach((q, i) => {
    const prompt = String(q.prompt || "").trim();
    if (!prompt || [...prompt].length > 60) throw new Error(`q${i}: bad prompt`);
    const ability = ABILITIES.includes(q.ability) ? q.ability : "extract";
    const { options, answer } = checkChoice(q, `q${i}`);
    let evidence = Number(q.evidence);
    evidence = Number.isInteger(evidence) && evidence >= 1 && evidence <= paras.length ? evidence - 1 : null;
    questions.push({ kind: "choice", ability, prompt, options, answer, evidence, explain: String(q.explain || "").slice(0, 80) });
  });
  if (questions.length < 3) throw new Error("need at least 3 questions");
  let purpose = null;
  if (o.purpose && o.purpose.task) {
    const qi = Number(o.purpose.q);
    purpose = { task: String(o.purpose.task).slice(0, 40), q: Number.isInteger(qi) && qi >= 0 && qi < questions.length ? qi : 0 };
  }
  let guess = null;
  if (o.guess && o.guess.word && body.includes(String(o.guess.word))) {
    try {
      const { options, answer } = checkChoice(o.guess, "guess");
      const word = String(o.guess.word);
      const para = paras.findIndex((p) => p.includes(word));
      guess = { kind: "guess", ability: "word", prompt: `猜一猜：“${word}”在这里是什么意思？`, word, options, answer, evidence: para, explain: String(o.guess.explain || "").slice(0, 80) };
    } catch { guess = null; }
  }
  return { purpose, questions, guess };
}

export async function makeQuestions(env, { title, body, guessChars }) {
  if (env.AI_MOCK === "1") return mockQuestions(body, guessChars);
  return generate(env, questionPrompt(title, body, guessChars), (o) => validateQuestions(o, body), { maxTokens: 1600 });
}

function mockQuestions(body, guessChars) {
  const paras = paragraphs(body);
  const questions = paras.slice(0, 4).map((p, i) => {
    const han = [...p].filter(isHan);
    const right = han.slice(0, 2).join("");
    return {
      kind: "choice", ability: ["extract", "extract", "infer", "summarise"][i],
      prompt: `（模拟题）第 ${i + 1} 段开头的两个字是什么？`,
      options: [right, "小狗", "月亮"].filter((x, j, a) => a.indexOf(x) === j).concat(["星星"]).slice(0, 3),
      answer: 0, evidence: i, explain: "（模拟解析）回到这一段开头看看。",
    };
  });
  const ch = guessChars[0];
  let guess = null;
  if (ch) {
    const i = body.indexOf(ch);
    const word = body[i + 1] && isHan(body[i + 1]) ? ch + body[i + 1] : ch;
    guess = { kind: "guess", ability: "word", prompt: `猜一猜：“${word}”在这里是什么意思？`, word, options: ["（模拟）正确意思", "（模拟）错误意思一", "（模拟）错误意思二"], answer: 0, evidence: paragraphs(body).findIndex((p) => p.includes(word)), explain: "（模拟）联系前后文就能猜到。" };
  }
  return { purpose: { task: "（模拟）读的时候留意每段开头的字", q: 0 }, questions, guess };
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
  if (!items.length || env.AI_MOCK === "1") return {};
  return generate(env, polyphonePrompt(items), (o) => validatePolyphones(o, items), { maxTokens: 60 + items.length * 14, temperature: 0.1 });
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
