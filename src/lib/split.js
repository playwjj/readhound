// Long texts (book chapters, web stories) become several articles a child
// can read in one sitting (ideal 600–900 characters, ceiling 1600), cut at
// paragraph ends — or sentence ends inside a very long paragraph.

const han = (s) => (s.match(/\p{Script=Han}/gu) || []).length;
const NUM = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十"];
export const partLabel = (i) => NUM[i] || String(i + 1);

/** Split a paragraph longer than `max` Han characters at sentence ends. */
function splitParagraph(p, max) {
  if (han(p) <= max) return [p];
  const sentences = p.match(/[^。！？!?…]+(?:[。！？!?…]+[”」』）)]*)?/g) || [p];
  const out = [];
  let cur = "";
  for (const s of sentences) {
    if (cur && han(cur) + han(s) > max) {
      out.push(cur);
      cur = "";
    }
    cur += s;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * text: paragraphs separated by \n. Returns the parts (each a \n-joined text).
 * A text within `max` stays whole; otherwise it is cut into nearly equal
 * parts of about `target` characters.
 */
export function splitLong(text, { max = 1500, target = 1000, min = 350 } = {}) {
  const paras = String(text).split("\n").map((p) => p.trim()).filter(Boolean).flatMap((p) => splitParagraph(p, Math.round(max * 0.6)));
  const total = han(paras.join(""));
  if (total <= max) return [paras.join("\n")];
  const n = Math.max(2, Math.round(total / target));
  const size = total / n;
  const parts = [];
  let cur = [], acc = 0;
  for (const p of paras) {
    const h = han(p);
    // close a part once this paragraph would carry it (by more than half) past its share
    if (cur.length && parts.length < n - 1 && acc + h / 2 > size * (parts.length + 1)) {
      parts.push(cur);
      cur = [];
    }
    cur.push(p);
    acc += h;
  }
  if (cur.length) parts.push(cur);
  // a short tail joins the part before it (if that stays within the ceiling)
  const last = parts[parts.length - 1];
  if (parts.length > 1 && han(last.join("")) < min && han(parts[parts.length - 2].join("")) + han(last.join("")) <= max) {
    parts[parts.length - 2].push(...parts.pop());
  }
  return parts.map((p) => p.join("\n"));
}
