// Thin D1 helpers + settings with defaults.
import { DEFAULT_PARAMS } from "./lib/text.js";

export const all = async (env, sql, ...args) => (await env.DB.prepare(sql).bind(...args).all()).results || [];
export const first = (env, sql, ...args) => env.DB.prepare(sql).bind(...args).first();
export const run = (env, sql, ...args) => env.DB.prepare(sql).bind(...args).run();
export const stmt = (env, sql, ...args) => env.DB.prepare(sql).bind(...args);
/** D1 batch, chunked (D1 caps statements per batch). */
export async function batch(env, statements, size = 80) {
  for (let i = 0; i < statements.length; i += size) await env.DB.batch(statements.slice(i, i + size));
}

export const DEFAULT_SETTINGS = {
  params: DEFAULT_PARAMS,
  target_new: 5, // adapted automatically, see adaptTarget()
  pinyin: "all", // all | new (only new chars) | off
  font_size: 22,
  session_min: 15, // one "episode", then a rest page
  rest_min: 2,
  daily_limit_min: 40, // beyond this: listen-only
  bedtime: "21:00", // after this: listen-only (no lit-screen reading)
  wake_time: "06:00",
  interests: [],
  rewards: [
    { bones: 60, item: "多玩 30 分钟" },
    { bones: 100, item: "周末活动由你挑" },
    { bones: 150, item: "指定明天读什么题材" },
  ],
  audio: true, // pre-generate read-aloud when a TTS_MODEL is configured (else device voice)
  freezes: 0,
  freeze_earned_at: 0,
  skill_days: 5, // completed readings between skill unlocks
  child_name: "小读者",
  pinyin_fixes: [], // [{word: "长着", pinyin: "zhǎng zhe"}] — parent corrections, win over everything
};

export async function getSettings(env) {
  const rows = await all(env, "SELECT key, value FROM settings");
  const s = structuredClone(DEFAULT_SETTINGS);
  for (const r of rows) {
    try { s[r.key] = JSON.parse(r.value); } catch { /* keep default */ }
  }
  s.params = { ...DEFAULT_PARAMS, ...(s.params || {}) };
  return s;
}

export async function setSetting(env, key, value) {
  await run(env, "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", key, JSON.stringify(value));
}

/** The child's known set: familiar + mastered. Small table (≤ a few thousand rows). */
export async function knownSet(env) {
  const rows = await all(env, "SELECT char FROM chars WHERE status IN ('familiar','mastered')");
  return new Set(rows.map((r) => r.char));
}
