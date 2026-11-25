-- 2026-11-25: textbook progress by unit (课本进度). Applied by CI on push.
CREATE TABLE IF NOT EXISTS textbook_units (
  id         INTEGER PRIMARY KEY,
  volume     TEXT NOT NULL,              -- 四上 | 四下
  unit       INTEGER NOT NULL,
  theme      TEXT,                       -- unit theme (人文主题)
  focus      TEXT,                       -- 语文要素 (reading focus), as printed
  skill      TEXT,                       -- matching ability: extract | infer | summarise | theme | word | locate
  genre      TEXT,                       -- genre the unit leans to (myth, science, history, ...)
  topics     TEXT,                       -- keywords for article selection / story themes
  lessons    TEXT,                       -- lesson titles, 、-separated
  recognise  TEXT NOT NULL DEFAULT '',   -- 识字表 characters of the unit
  write      TEXT NOT NULL DEFAULT '',   -- 写字表 characters of the unit
  verified   INTEGER NOT NULL DEFAULT 0, -- 1 = checked against the child's own book
  UNIQUE (volume, unit)
);
