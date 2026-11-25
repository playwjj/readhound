/** Celebration confetti (removed after 4 s). */
export function confetti() {
  const box = document.createElement("div");
  box.className = "confetti";
  const colors = ["#7b5cc8", "#f2c230", "#3f8f5a", "#3e74b8", "#e86aa0"];
  for (let i = 0; i < 60; i++) {
    const p = document.createElement("i");
    p.style.cssText = `left:${Math.random() * 100}%;background:${colors[i % colors.length]};animation-delay:${Math.random() * 0.8}s;animation-duration:${2 + Math.random() * 1.5}s`;
    box.append(p);
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 4000);
}
export const isHan = (c) => /\p{Script=Han}/u.test(c);
export const shuffle = (a) => [...a].sort(() => Math.random() - 0.5);
