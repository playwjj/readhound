-- 2026-11-25: polyphone check stage (commit "Polyphone readings").
-- Databases created from db/schema.sql before this commit lack the column.
-- Run once:  npm run db:migrate (CI does this on push)
ALTER TABLE articles ADD COLUMN polyphones_fixed INTEGER;
