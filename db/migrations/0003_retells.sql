-- 2026-11-25: voice retelling (语音复述). Run once:  npm run db:migrate (CI does this on push)
CREATE TABLE IF NOT EXISTS retells (
  id          INTEGER PRIMARY KEY,
  session_id  INTEGER NOT NULL REFERENCES sessions(id),
  transcript  TEXT NOT NULL,
  covered     TEXT NOT NULL,             -- JSON: key points the child told
  total       INTEGER NOT NULL,          -- number of key points
  feedback    TEXT,
  tip         TEXT,
  at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_retells_session ON retells(session_id);
