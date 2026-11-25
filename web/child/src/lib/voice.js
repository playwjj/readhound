// Read-aloud: the device's Chinese voice, or pre-generated audio if any.
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
export function speak(text, rate = 0.85) {
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
export function stopAudio() {
  if (currentAudio) currentAudio.pause();
  currentAudio = null;
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}
/** Is anything being read aloud right now? (reading time counts while listening) */
export const isPlaying = () => (currentAudio && !currentAudio.paused) || !!(window.speechSynthesis && speechSynthesis.speaking);

/** Paragraph read-aloud: pre-generated audio if any, device voice otherwise. */
export function playParagraph(p) {
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
