-- 2026-11-25: phase-2 skills (predict / locate / section) keep their
-- positions in questions.meta. Run once:  npm run db:migrate 0002_question_meta
ALTER TABLE questions ADD COLUMN meta TEXT;
