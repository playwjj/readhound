// Web page → title + story paragraphs. Used by the parent's "paste a link"
// import (in the Worker) and by scripts/import.mjs.

const han = (s) => (String(s).match(/\p{Script=Han}/gu) || []).length;

/** Bytes → text, honouring the charset in the header or the page (GBK pages are common). */
export function decode(buf, contentType = "") {
  const head = new TextDecoder("latin1").decode(buf.slice(0, 4096));
  const cs = (contentType.match(/charset=([\w-]+)/i) || head.match(/charset=["']?([\w-]+)/i) || [])[1] || "utf-8";
  try {
    return new TextDecoder(cs.toLowerCase().replace(/^gb2312$/, "gbk")).decode(buf);
  } catch {
    return new TextDecoder("utf-8").decode(buf);
  }
}

const entities = (s) => s.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&");
const strip = (s) => entities(s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).replace(/[​-‍﻿]/g, "").replace(/[ \t　 ]+/g, " ").trim();
const BOILER = /版权|copyright|上一篇|下一篇|责任编辑|扫码|关注|阅读全文|点击|微信|公众号|原标题|来源：|编辑：|阅读原文|分享|收藏|点赞/i;

// licence notes and reprint lines, whatever their length
const LEGAL = /公有领域|公有領域|版权所有|版權所有|著作权法|著作權法|版权期限|版權期限|免责声明|转载请|轉載請|本文来源|侵权/;

export function extract(html) {
  html = String(html);
  // WeChat articles keep the text in #js_content (sections / spans, few <p>s)
  const wx = html.match(/id="js_content"[^>]*>([\s\S]*?)<\/div>\s*<script/i);
  const wxTitle = html.match(/var msg_title = ['"]([^'"]+)/) || html.match(/property="og:title" content="([^"]+)"/);
  const clean = html.replace(/<(script|style|noscript|nav|header|footer|aside|form|iframe)[\s\S]*?<\/\1>/gi, "");
  const title = entities(wxTitle?.[1] || strip((clean.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || clean.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || ""))
    .split(/[_|\-–—]/)[0].trim().slice(0, 40);
  let paras;
  if (wx) {
    paras = strip(wx[1].replace(/<\/(p|section|h\d|li)>/gi, "\n")).split("\n");
  } else {
    // <p> blocks with real Chinese text; boilerplate lines are short
    paras = [...clean.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => strip(m[1])).flatMap((p) => p.split("\n"));
    if (han(paras.join("")) < 200) {
      // little <p> structure: the block with the most Chinese text, if it has more
      const blocks = [...clean.matchAll(/<(div|td|article|section)[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => strip(m[2].replace(/<\/(p|div|h\d|li)>/gi, "\n")));
      const best = blocks.sort((a, b) => han(b) - han(a))[0] || "";
      if (han(best) > han(paras.join(""))) paras = best.split("\n");
    }
  }
  paras = paras.map((p) => p.trim()).filter((p) => han(p) >= 8 && !(han(p) < 40 && BOILER.test(p)) && !LEGAL.test(p));
  return { title, body: paras.join("\n") };
}

export const hanCount = han;
