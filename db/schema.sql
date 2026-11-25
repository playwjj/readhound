-- ReadHound D1 schema (phase-1 skeleton)
-- All queries must use indexes; no full-table scans.

-- Where materials came from (public-domain libraries, school platform,
-- family books...). The corpus itself lives only in this database.
CREATE TABLE IF NOT EXISTS sources (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL,             -- public_domain | school | family_book | web
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One reading material. Preparation results (difficulty, new characters,
-- questions, audio) are computed once at ingest time.
CREATE TABLE IF NOT EXISTS articles (
  id                INTEGER PRIMARY KEY,
  source_id         INTEGER REFERENCES sources(id),
  title             TEXT NOT NULL,
  body              TEXT NOT NULL,       -- plain text, paragraphs split by \n
  genre             TEXT,                -- myth | fable | science | story | poem ...
  char_count        INTEGER NOT NULL,
  coverage          REAL,                -- share of chars inside grade 1-4 lists
  new_char_density  REAL,                -- new chars per 100 chars vs child's known set
  avg_sentence_len  REAL,
  difficulty        INTEGER,             -- composite score, higher = harder
  age_fit           TEXT,                -- ai judgement: ok | flagged
  ai_note           TEXT,                -- one-line ai comment (genre / interest)
  audio_key         TEXT,                -- R2 key of pre-generated read-aloud audio
  status            TEXT NOT NULL DEFAULT 'screened', -- screened | ready | retired
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_articles_status_difficulty
  ON articles(status, difficulty);

-- The character archive: one row per character the child has met.
-- This is the heart of the new-character system （生字溯源）.
CREATE TABLE IF NOT EXISTS characters (
  char         TEXT PRIMARY KEY,
  pinyin       TEXT,
  gloss        TEXT,                     -- child-friendly definition
  status       TEXT NOT NULL DEFAULT 'seen', -- seen | familiar | mastered
  first_seen_at TEXT,
  seen_count   INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Every appearance of a character in an article: "where have I seen
-- this character before?" is answered from this table.
CREATE TABLE IF NOT EXISTS char_encounters (
  char        TEXT NOT NULL,
  article_id  INTEGER NOT NULL REFERENCES articles(id),
  occurrences INTEGER NOT NULL,
  PRIMARY KEY (char, article_id)
);
CREATE INDEX IF NOT EXISTS idx_encounters_article ON char_encounters(article_id);

-- The child's personal known-character set, seeded by the baseline
-- assessment and maintained by reading/answer outcomes.
CREATE TABLE IF NOT EXISTS known_chars (
  char       TEXT PRIMARY KEY,
  origin     TEXT NOT NULL,              -- assessment | reading | question
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Pre-generated quest questions, one ability tag each.
CREATE TABLE IF NOT EXISTS questions (
  id          INTEGER PRIMARY KEY,
  article_id  INTEGER NOT NULL REFERENCES articles(id),
  type        TEXT NOT NULL,             -- choice | locate | voice
  ability     TEXT NOT NULL,             -- extract | word | infer | summarise | theme
  prompt      TEXT NOT NULL,
  options     TEXT,                      -- JSON array for choice questions
  answer      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_questions_article ON questions(article_id);

-- Reading progress: in-article position, completion, duration.
CREATE TABLE IF NOT EXISTS reading_sessions (
  id             INTEGER PRIMARY KEY,
  article_id     INTEGER NOT NULL REFERENCES articles(id),
  started_at     TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at    TEXT,
  last_paragraph INTEGER NOT NULL DEFAULT 0,
  completed      INTEGER NOT NULL DEFAULT 0  -- 0/1
);
CREATE INDEX IF NOT EXISTS idx_sessions_article ON reading_sessions(article_id);

-- Answers feed the ability radar and the known-character set.
CREATE TABLE IF NOT EXISTS answers (
  id          INTEGER PRIMARY KEY,
  session_id  INTEGER NOT NULL REFERENCES reading_sessions(id),
  question_id INTEGER NOT NULL REFERENCES questions(id),
  correct     INTEGER NOT NULL,          -- 0/1
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_answers_session ON answers(session_id);

-- The scheduler's daily pick.
CREATE TABLE IF NOT EXISTS daily_pick (
  date       TEXT PRIMARY KEY,           -- YYYY-MM-DD, Asia/Shanghai
  article_id INTEGER NOT NULL REFERENCES articles(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
