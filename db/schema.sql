-- ReadHound D1 schema (phase 1)
-- Rule: every query on a growing table goes through an index; no full scans
-- of articles / encounters / answers / sessions.

-- Key/value settings (JSON values): params, eye-care, interests, rewards...
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Where materials came from. The corpus itself lives only in this database.
CREATE TABLE IF NOT EXISTS sources (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  kind        TEXT NOT NULL,             -- public_domain | school | family_book | web | sample
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One reading material. Everything except today's pick is computed once
-- by the ingest pipeline (src/pipeline.js), one stage per step.
CREATE TABLE IF NOT EXISTS articles (
  id                INTEGER PRIMARY KEY,
  source_id         INTEGER REFERENCES sources(id),
  title             TEXT NOT NULL,
  body              TEXT NOT NULL,       -- plain text, paragraphs split by \n
  genre             TEXT,                -- myth | fable | fairy | science | story | poem | life | history
  tags              TEXT,                -- JSON array of interest tags (ai)
  char_count        INTEGER NOT NULL DEFAULT 0,
  unique_chars      INTEGER,
  uniq              TEXT,                -- every distinct Han char, first-appearance order
  coverage          REAL,                -- share of chars within grades 1-4
  rare_density      REAL,                -- chars outside level-1 per 100 chars
  avg_sentence_len  REAL,
  max_sentence_len  INTEGER,
  difficulty        INTEGER,             -- 0-100, grade-4 average reader
  age_fit           TEXT,                -- ok | flagged
  ai_note           TEXT,                -- one-line ai comment
  reject_reason     TEXT,
  pinyin            TEXT,                -- JSON array: per paragraph, space-separated syllables per Han char
  audio             TEXT,                -- JSON array: R2 key per paragraph (null = use device voice)
  purpose           TEXT,                -- 带着问题读: the pre-reading observation task
  status            TEXT NOT NULL DEFAULT 'queued', -- queued | processing | flagged | ready | rejected | retired
  stage             TEXT NOT NULL DEFAULT 'metrics', -- next pipeline stage
  attempts          INTEGER NOT NULL DEFAULT 0,
  last_error        TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  ready_at          TEXT
);
CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status, difficulty);
CREATE INDEX IF NOT EXISTS idx_articles_title ON articles(title);

-- Context glosses for characters of an article (word as used in the text).
CREATE TABLE IF NOT EXISTS glosses (
  article_id INTEGER NOT NULL REFERENCES articles(id),
  char       TEXT NOT NULL,
  pinyin     TEXT NOT NULL,
  word       TEXT,                       -- the word in the article containing the char
  gloss      TEXT,                       -- child-friendly meaning
  example    TEXT,                       -- one example sentence
  PRIMARY KEY (article_id, char)
);

-- Every non-core character occurrence per article (core = 300 most
-- frequent). "Where have I seen this character?" reads this table.
CREATE TABLE IF NOT EXISTS char_encounters (
  char        TEXT NOT NULL,
  article_id  INTEGER NOT NULL REFERENCES articles(id),
  occurrences INTEGER NOT NULL,
  PRIMARY KEY (char, article_id)
);
CREATE INDEX IF NOT EXISTS idx_encounters_article ON char_encounters(article_id);

-- The character archive and the child's known set in one table.
-- known set = status IN ('familiar','mastered').
-- 未见 = no row; seen = 见过; familiar = 认识; mastered = 掌握.
CREATE TABLE IF NOT EXISTS chars (
  char              TEXT PRIMARY KEY,
  status            TEXT NOT NULL,       -- seen | familiar | mastered
  origin            TEXT NOT NULL,       -- assessment | inferred | reading | textbook | parent
  pinyin            TEXT,
  gloss             TEXT,
  word              TEXT,
  first_seen_at     TEXT,
  first_article_id  INTEGER,
  correct_articles  TEXT NOT NULL DEFAULT '[]', -- JSON: distinct article ids answered right
  lapses            INTEGER NOT NULL DEFAULT 0,
  due_at            TEXT,                -- YYYY-MM-DD, next review (null = not in review pool)
  mastered_at       TEXT,
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chars_status ON chars(status, due_at);
CREATE INDEX IF NOT EXISTS idx_chars_mastered ON chars(mastered_at);
CREATE INDEX IF NOT EXISTS idx_chars_origin ON chars(origin, status);

-- Textbook unit lists: characters school is teaching now / soon.
CREATE TABLE IF NOT EXISTS textbook_chars (
  char    TEXT PRIMARY KEY,
  unit    TEXT,
  added_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Pre-generated quest questions, one ability tag each.
CREATE TABLE IF NOT EXISTS questions (
  id          INTEGER PRIMARY KEY,
  article_id  INTEGER NOT NULL REFERENCES articles(id),
  ord         INTEGER NOT NULL,
  kind        TEXT NOT NULL,             -- choice | guess (猜词义, shown inline)
  ability     TEXT NOT NULL,             -- extract | word | infer | summarise | theme
  prompt      TEXT NOT NULL,
  options     TEXT NOT NULL,             -- JSON array of strings
  answer      INTEGER NOT NULL,          -- index into options
  evidence    INTEGER,                   -- paragraph index holding the answer
  word        TEXT,                      -- guess: the word being guessed
  explain     TEXT,                      -- shown after answering
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_questions_article ON questions(article_id, ord);

-- One reading of one article. Process signals live here.
CREATE TABLE IF NOT EXISTS sessions (
  id             INTEGER PRIMARY KEY,
  article_id     INTEGER NOT NULL REFERENCES articles(id),
  date           TEXT NOT NULL,          -- YYYY-MM-DD Asia/Shanghai
  daily          INTEGER NOT NULL DEFAULT 1, -- 1 = today's pick, 0 = extra reading
  started_at     TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at    TEXT,
  last_paragraph INTEGER NOT NULL DEFAULT 0,
  level          INTEGER NOT NULL DEFAULT 0, -- 0 opened, 1 read body, 2 completed, 3 retold
  active_ms      INTEGER NOT NULL DEFAULT 0,
  dwell          TEXT NOT NULL DEFAULT '[]', -- JSON: ms per paragraph
  taps           INTEGER NOT NULL DEFAULT 0,
  tapped         TEXT NOT NULL DEFAULT '',   -- distinct chars tapped
  new_chars      TEXT,                   -- JSON: chars taught in this session
  accuracy       REAL,                   -- first-try weighted accuracy
  char_ok        INTEGER,
  char_total     INTEGER,
  verdict        TEXT,                   -- JSON from verdict()
  bones          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date);
CREATE INDEX IF NOT EXISTS idx_sessions_article ON sessions(article_id);
CREATE INDEX IF NOT EXISTS idx_sessions_level ON sessions(level, date);

CREATE TABLE IF NOT EXISTS answers (
  id          INTEGER PRIMARY KEY,
  session_id  INTEGER NOT NULL REFERENCES sessions(id),
  question_id INTEGER NOT NULL REFERENCES questions(id),
  ability     TEXT NOT NULL,
  choice      INTEGER NOT NULL,
  correct     INTEGER NOT NULL,          -- 0/1
  attempt     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_answers_session ON answers(session_id);
CREATE INDEX IF NOT EXISTS idx_answers_created ON answers(created_at);

-- Post-reading character quiz results.
CREATE TABLE IF NOT EXISTS char_quiz (
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  char       TEXT NOT NULL,
  correct    INTEGER NOT NULL,
  review     INTEGER NOT NULL DEFAULT 0, -- 1 = due-review char, 0 = this article's new char
  retry_ok   INTEGER NOT NULL DEFAULT 0, -- right on a second look (counts for the gate, not the SRS)
  PRIMARY KEY (session_id, char)
);

-- Scheduler's pick per day.
CREATE TABLE IF NOT EXISTS daily_pick (
  date       TEXT PRIMARY KEY,
  article_id INTEGER NOT NULL REFERENCES articles(id),
  reason     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per day with activity: streak + eye-care minutes.
CREATE TABLE IF NOT EXISTS days (
  date        TEXT PRIMARY KEY,
  completed   INTEGER NOT NULL DEFAULT 0,
  freeze_used INTEGER NOT NULL DEFAULT 0,
  screen_ms   INTEGER NOT NULL DEFAULT 0,
  extra_bonus INTEGER NOT NULL DEFAULT 0  -- extra-reading bones granted today
);

-- Bones (骨头) ledger. Only ever adds, except parent-confirmed redemptions.
CREATE TABLE IF NOT EXISTS ledger (
  id      INTEGER PRIMARY KEY,
  at      TEXT NOT NULL DEFAULT (datetime('now')),
  amount  INTEGER NOT NULL,
  reason  TEXT NOT NULL,
  ref     TEXT
);

-- Collected things: medals, puppy accessories, chest surprises.
CREATE TABLE IF NOT EXISTS awards (
  code   TEXT PRIMARY KEY,               -- medal:streak7, acc:scarf, ...
  kind   TEXT NOT NULL,                  -- medal | accessory
  title  TEXT NOT NULL,
  at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Known-set size over time for the 识字量 curve.
CREATE TABLE IF NOT EXISTS snapshots (
  date      TEXT PRIMARY KEY,
  known     INTEGER NOT NULL,
  mastered  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS assessments (
  id       INTEGER PRIMARY KEY,
  at       TEXT NOT NULL DEFAULT (datetime('now')),
  estimate INTEGER NOT NULL,
  detail   TEXT NOT NULL                 -- JSON per level
);
