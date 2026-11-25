// 课本进度: the child's textbook by unit. The current unit steers what the
// app teaches: its characters (and the next unit's) become targets, earlier
// units' characters the child does not know yet join the review pool, and
// article picks / generated stories lean to the unit's theme and skill.
import { all, first, run, stmt, batch, getSettings, setSetting } from "./db.js";
import { SEED_UNITS, SKILL_OPTIONS } from "./data/curriculum.js";
import { isHan } from "./lib/text.js";
import { cnDate } from "./lib/logic.js";
import { GENRES } from "./lib/ai.js";

const hanOnly = (s) => [...new Set([...String(s || "")].filter(isHan))].join("");

async function ensureSeed(env) {
  if ((await first(env, "SELECT COUNT(*) n FROM textbook_units")).n) return;
  await batch(env, SEED_UNITS.map((u) => stmt(env,
    "INSERT OR IGNORE INTO textbook_units (volume, unit, theme, focus, skill, genre, topics, lessons) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    u.volume, u.unit, u.theme, u.focus, u.skill, u.genre, u.topics, u.lessons)));
}

export async function listUnits(env) {
  await ensureSeed(env);
  const units = await all(env, "SELECT * FROM textbook_units ORDER BY volume DESC, unit");
  const s = await getSettings(env);
  return { units, current: s.current_unit || null, skills: SKILL_OPTIONS, genres: GENRES };
}

export async function saveUnit(env, b) {
  const volume = ["四上", "四下"].includes(b.volume) ? b.volume : null;
  const unit = Number(b.unit);
  if (!volume || !(unit >= 1 && unit <= 8)) throw new Error("单元编号不对");
  const text = (v, n) => String(v ?? "").trim().slice(0, n);
  await run(env, `INSERT INTO textbook_units (volume, unit, theme, focus, skill, genre, topics, lessons, recognise, write, verified)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(volume, unit) DO UPDATE SET theme = excluded.theme, focus = excluded.focus, skill = excluded.skill, genre = excluded.genre,
        topics = excluded.topics, lessons = excluded.lessons, recognise = excluded.recognise, write = excluded.write, verified = excluded.verified`,
    volume, unit, text(b.theme, 30), text(b.focus, 120), SKILL_OPTIONS[b.skill] ? b.skill : null, GENRES.includes(b.genre) ? b.genre : null,
    text(b.topics, 80), text(b.lessons, 300), hanOnly(b.recognise), hanOnly(b.write), b.verified ? 1 : 0);
  const s = await getSettings(env);
  if (s.current_unit && s.current_unit.volume === volume && s.current_unit.unit === unit) await setCurrent(env, s.current_unit);
  return listUnits(env);
}

/** The unit row the child is on (or null). */
export async function currentUnit(env) {
  const s = await getSettings(env);
  if (!s.current_unit) return null;
  return first(env, "SELECT * FROM textbook_units WHERE volume = ? AND unit = ?", s.current_unit.volume, s.current_unit.unit);
}

const ORDER = (u) => (u.volume === "四上" ? 0 : 8) + u.unit;

/**
 * Set the unit the class is on: this unit + the next one become the
 * "upcoming" characters; earlier units' characters the child does not know
 * yet enter the review pool (status 见过, due today).
 */
export async function setCurrent(env, { volume, unit }) {
  await ensureSeed(env);
  const units = await all(env, "SELECT * FROM textbook_units ORDER BY volume DESC, unit");
  const cur = units.find((u) => u.volume === volume && u.unit === Number(unit));
  if (!cur) throw new Error("没有这个单元");
  await setSetting(env, "current_unit", { volume, unit: Number(unit) });
  const k = ORDER(cur);
  const next = units.find((u) => ORDER(u) === k + 1);
  const label = (u) => `${u.volume}第${u.unit}单元`;
  await run(env, "DELETE FROM textbook_chars");
  const upcoming = [];
  for (const u of [cur, next].filter(Boolean)) for (const ch of new Set([...u.recognise, ...u.write])) upcoming.push([ch, label(u)]);
  await batch(env, upcoming.map(([ch, l]) => stmt(env, "INSERT OR IGNORE INTO textbook_chars (char, unit) VALUES (?, ?)", ch, l)));
  const earlier = [...new Set(units.filter((u) => ORDER(u) < k).flatMap((u) => [...u.recognise, ...u.write]))];
  let review = 0;
  if (earlier.length) {
    const have = new Set((await all(env, "SELECT char FROM chars")).map((r) => r.char));
    const add = earlier.filter((ch) => !have.has(ch));
    await batch(env, add.map((ch) => stmt(env, "INSERT OR IGNORE INTO chars (char, status, origin, first_seen_at, due_at) VALUES (?, 'seen', 'textbook', ?, ?)", ch, cnDate(), cnDate())));
    review = add.length;
  }
  return { ok: true, upcoming: upcoming.length, review };
}
