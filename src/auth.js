// Family login gate (§12 访问控制): a PIN per role, HMAC-signed cookies.
// Secrets: CHILD_PIN, PARENT_PIN, SESSION_SECRET (wrangler secret put ...).
// One cookie per role: a parent logging in on the child's iPad must not
// turn the child's app into a parent session. The parent cookie is short.
const COOKIE = { child: "rh_child", parent: "rh_parent" };
const TTL = { child: 180 * 86400, parent: 12 * 3600 };

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export function configured(env) {
  return Boolean(env.SESSION_SECRET && env.CHILD_PIN && env.PARENT_PIN);
}

/** Which role a PIN unlocks, or null. */
export function roleForPin(env, pin) {
  pin = String(pin || "");
  if (env.PARENT_PIN && safeEqual(pin, String(env.PARENT_PIN))) return "parent";
  if (env.CHILD_PIN && safeEqual(pin, String(env.CHILD_PIN))) return "child";
  return null;
}

export async function issue(env, role, secure) {
  const exp = Math.floor(Date.now() / 1000) + TTL[role];
  const payload = `${role}.${exp}`;
  const sig = await hmac(env.SESSION_SECRET, payload);
  return `${COOKIE[role]}=${payload}.${sig}; Path=/; Max-Age=${TTL[role]}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export function clear(role) {
  return `${COOKIE[role]}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}

async function valid(env, request, role) {
  const m = (request.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${COOKIE[role]}=([^;]+)`));
  if (!m || !env.SESSION_SECRET) return false;
  const [r, exp, sig] = m[1].split(".");
  if (r !== role || !(Number(exp) > Date.now() / 1000)) return false;
  return safeEqual(sig || "", await hmac(env.SESSION_SECRET, `${r}.${exp}`));
}

/**
 * Roles this request holds. `area` says which app is asking (the parent
 * console sends x-rh-area: parent); the child app only ever sees 'child'.
 */
export async function rolesOf(env, request) {
  return { child: await valid(env, request, "child"), parent: await valid(env, request, "parent") };
}

/** Tiny in-memory throttle for PIN guessing (per isolate; good enough for a family app). */
const fails = new Map();
export function throttled(ip) {
  const f = fails.get(ip);
  return f && f.n >= 5 && Date.now() - f.t < 5 * 60000;
}
export function noteFail(ip) {
  const f = fails.get(ip) || { n: 0, t: 0 };
  if (Date.now() - f.t > 5 * 60000) f.n = 0;
  f.n++;
  f.t = Date.now();
  fails.set(ip, f);
}
export function noteOk(ip) {
  fails.delete(ip);
}
