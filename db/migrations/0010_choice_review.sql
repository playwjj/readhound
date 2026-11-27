-- 2026-11-27: 每日二选一 — the day's pick comes with alternatives the child may choose instead.
ALTER TABLE daily_pick ADD COLUMN alts TEXT; -- JSON [article_id, …]; NULL = no choice (parent's pick)

-- 错题回炉: comprehension questions missed first time come back on later days.
CREATE TABLE IF NOT EXISTS review_answers (
  id          INTEGER PRIMARY KEY,
  session_id  INTEGER NOT NULL REFERENCES sessions(id),
  question_id INTEGER NOT NULL REFERENCES questions(id),
  ability     TEXT NOT NULL,
  choice      INTEGER NOT NULL,
  correct     INTEGER NOT NULL,          -- 0/1, one try per question per session
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_review_question ON review_answers(question_id);
CREATE INDEX IF NOT EXISTS idx_review_session ON review_answers(session_id);
