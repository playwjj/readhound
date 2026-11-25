-- 2026-11-26: long texts are split into parts read in order (公版名篇书架, 网页导入).
-- series: the book / text the part belongs to; part: 1, 2, 3 … in reading order.
ALTER TABLE articles ADD COLUMN series TEXT;
ALTER TABLE articles ADD COLUMN part INTEGER;
CREATE INDEX IF NOT EXISTS idx_articles_series ON articles(series, part);
