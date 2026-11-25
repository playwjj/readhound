// The reading companion: a small hound drawn in SVG. Grows with the
// stage (pup → legend) and wears the accessories won from chests.
export function pupSVG(stage = "pup", accessories = [], mood = "happy") {
  const has = (c) => accessories.some((a) => (a.code || a) === `acc:${c}`);
  const scale = { pup: 0.82, young: 0.9, tracker: 0.96, gold: 1, legend: 1 }[stage] || 0.9;
  const fur = stage === "gold" || stage === "legend" ? "#e0b25a" : "#d9a066";
  const eye = mood === "sleepy"
    ? '<path d="M76 92q8 6 16 0M128 92q8 6 16 0" stroke="#3a2a1d" stroke-width="5" fill="none" stroke-linecap="round"/>'
    : '<circle cx="84" cy="92" r="8" fill="#3a2a1d"/><circle cx="136" cy="92" r="8" fill="#3a2a1d"/><circle cx="87" cy="89" r="2.6" fill="#fff"/><circle cx="139" cy="89" r="2.6" fill="#fff"/>';
  const parts = [];
  if (has("cape")) parts.push('<path d="M62 150 L40 214 L180 214 L158 150 Z" fill="#7b5cc4"/>');
  if (has("backpack")) parts.push('<rect x="150" y="150" width="40" height="46" rx="10" fill="#4f8f5a"/><rect x="158" y="160" width="24" height="10" rx="4" fill="#3b6f45"/>');
  // body
  parts.push(`<ellipse cx="110" cy="182" rx="52" ry="34" fill="${fur}"/>`);
  parts.push('<ellipse cx="110" cy="190" rx="30" ry="20" fill="#f6e4c8"/>');
  // tail
  parts.push(`<path d="M158 176 q30 -10 26 -40" stroke="${fur}" stroke-width="12" fill="none" stroke-linecap="round" class="tail"/>`);
  // ears (behind head)
  parts.push('<path d="M52 70 q-22 40 0 78 q18 -6 22 -30 z" fill="#8a5a3b"/><path d="M168 70 q22 40 0 78 q-18 -6 -22 -30 z" fill="#8a5a3b"/>');
  // head
  parts.push(`<ellipse cx="110" cy="96" rx="58" ry="52" fill="${fur}"/>`);
  parts.push('<path d="M110 52 q-12 30 -6 64 h12 q6 -34 -6 -64z" fill="#fbf3e6"/>');
  parts.push('<ellipse cx="110" cy="124" rx="30" ry="22" fill="#fbf3e6"/>');
  parts.push(eye);
  parts.push('<ellipse cx="110" cy="114" rx="10" ry="7" fill="#3a2a1d"/>');
  parts.push('<path d="M100 128 q10 10 20 0" stroke="#3a2a1d" stroke-width="3.5" fill="none" stroke-linecap="round"/>');
  if (mood === "happy") parts.push('<path d="M106 131 q4 12 8 0" fill="#e2725b"/>');
  if (has("glasses")) parts.push('<g stroke="#2d2d2d" stroke-width="4" fill="none"><circle cx="84" cy="92" r="14"/><circle cx="136" cy="92" r="14"/><path d="M98 92h24"/></g>');
  if (has("scarf")) parts.push('<path d="M66 140 q44 22 88 0 l2 14 q-46 22 -92 0z" fill="#d9483b"/><rect x="128" y="148" width="14" height="28" rx="5" fill="#d9483b"/>');
  if (has("bow")) parts.push('<g fill="#e86aa0"><path d="M150 52 l-16 -10 v20z"/><path d="M150 52 l16 -10 v20z"/><circle cx="150" cy="52" r="5"/></g>');
  if (has("hat")) parts.push('<path d="M58 58 q52 -40 104 0 z" fill="#7a5a3c"/><rect x="48" y="54" width="124" height="10" rx="5" fill="#5c4129"/>');
  if (has("crown")) parts.push('<path d="M80 50 l8 -26 l14 16 l8 -22 l8 22 l14 -16 l8 26 z" fill="#f2c230" stroke="#c9912b" stroke-width="3"/>');
  if (has("headphones")) parts.push('<path d="M54 92 q0 -70 112 0" stroke="#444" stroke-width="7" fill="none"/><rect x="42" y="84" width="18" height="30" rx="8" fill="#e07a3f"/><rect x="160" y="84" width="18" height="30" rx="8" fill="#e07a3f"/>');
  if (has("badge")) parts.push('<path d="M110 164 l6 12 h13 l-10 8 l4 13 l-13 -8 l-13 8 l4 -13 l-10 -8 h13z" fill="#f2c230"/>');
  if (has("magnifier")) parts.push('<circle cx="36" cy="176" r="16" fill="rgba(180,220,255,.5)" stroke="#555" stroke-width="5"/><path d="M48 188 l16 16" stroke="#555" stroke-width="7" stroke-linecap="round"/>');
  if (stage === "legend") parts.push('<circle cx="110" cy="110" r="104" fill="none" stroke="#f2c230" stroke-width="3" stroke-dasharray="6 10"/>');
  return `<svg viewBox="0 0 220 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="小猎犬"><g transform="translate(${110 - 110 * scale} ${118 - 118 * scale}) scale(${scale})">${parts.join("")}</g></svg>`;
}
