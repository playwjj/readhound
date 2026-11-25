-- 2026-11-25: AI-generated supplementary stories (§11). The pipeline's first
-- stage writes the body from this spec. Applied by CI on push.
ALTER TABLE articles ADD COLUMN gen_spec TEXT;
