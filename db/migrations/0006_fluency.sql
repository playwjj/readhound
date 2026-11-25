-- 2026-11-25: read-aloud fluency (phase 3). Applied by CI on push.
CREATE TABLE IF NOT EXISTS fluency_reads (
  id          INTEGER PRIMARY KEY,
  session_id  INTEGER NOT NULL REFERENCES sessions(id),
  para        INTEGER NOT NULL,
  accuracy    REAL NOT NULL,             -- share of characters heard (toneless pinyin)
  cpm         INTEGER NOT NULL,          -- characters per minute
  missed      TEXT NOT NULL,             -- JSON: words to practise
  transcript  TEXT NOT NULL,
  at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fluency_session ON fluency_reads(session_id);
CREATE INDEX IF NOT EXISTS idx_fluency_at ON fluency_reads(at);
