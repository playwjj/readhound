-- 2026-11-25: Workers AI accounting per UTC day (the free allocation resets
-- at 00:00 UTC) and purpose. Applied by CI on push.
CREATE TABLE IF NOT EXISTS ai_usage (
  day       TEXT NOT NULL,               -- YYYY-MM-DD UTC
  purpose   TEXT NOT NULL,               -- screen | glosses | questions | skills | polyphones | story | retell | stt
  calls     INTEGER NOT NULL DEFAULT 0,
  in_chars  INTEGER NOT NULL DEFAULT 0,
  out_chars INTEGER NOT NULL DEFAULT 0,
  failures  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, purpose)
);
