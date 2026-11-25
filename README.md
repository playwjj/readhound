# ReadHound（字游记）

A family reading coach for a primary-school child: it sources real reading
materials (public-domain classics, school-aligned texts, the family's own
books), analyses each text against the child's *personal* known-character
set, prepares it for reading (pinyin, tap-to-hear, new-character cards),
and turns every article into a small level of a reading quest — with
reading-technique training and a per-skill comprehension report for the
parents.

The AI does not write the library. Its three jobs are:

1. **Screening** — is this text right for *this* child, right now?
   Hard metrics (known-character coverage, new-character density,
   sentence length) are computed in code; the model judges age-fit,
   genre and interest.
2. **Step control** — each session is staged: warm-up → read → quest
   questions → review, with skills unlocked one at a time.
3. **Easy to hard** — difficulty is sequenced within an article, across
   the reading list, and over months, driven by the child's growing
   known-character set.

New characters （生字） are first-class data: the system identifies them
per article, reminds the child before / during / after reading, and
records *which stories each character has appeared in* — so review
happens by meeting the character again in a new story.

## Architecture

Cloudflare Workers, one account, everything pre-generated at ingest time:

- **Worker** — serves the web app (PWA, added to the iPad home screen)
  and the API; a Cron Trigger runs ingestion and pre-generation.
- **D1** — articles, character archive, known-character set, reading
  and answer records.
- **R2** — pre-generated read-aloud audio.
- **Workers AI** — suitability judgement, new-character glosses,
  question generation, retelling assessment (Qwen); read-aloud via
  MeloTTS; speech-to-text via Whisper.

Reading content lives **only in the data layer (D1/R2)**. It is a private
family library: never committed to this repository, never packaged,
never redistributed. This repo contains code and public-domain samples
only.

## Status

Phase 1 implemented (2026-11-25). The full design (in Chinese) is in
[PROPOSAL.md](PROPOSAL.md).

What works end to end:

- **Baseline assessment** — a pinyin-choice game with one level per
  统编版 textbook volume (一上 → 五下, then non-textbook common characters),
  stopping at the first level below 50%; seeds the child's personal known
  set and reports "约到 X 年级 X 册".
- **Ingest pipeline** (`src/pipeline.js`) — hard metrics in code
  (coverage, sentence length, length, difficulty) → AI age-fit/genre →
  pinyin → character encounters → gloss cards → quest questions →
  MeloTTS audio. One stage per step, retried per stage, every model
  output validated in code. Sources: paste, bulk txt (`=== 标题`),
  zh.wikisource page import.
- **Daily pick** — ranked for *this* child: ~5 new characters (target
  adapts to recent accuracy), due-review characters reappearing,
  textbook characters, interests, genre rotation.
- **Reading session** — new-character warm-up + listen-and-tap game →
  pre-reading task → paragraph-by-paragraph reading with per-character
  pinyin, tap-to-hear, listen / follow / self modes → quest questions
  (wrong answers point back to the paragraph) → character quiz.
- **Completion verdict** (`verdict()` in `src/lib/logic.js`) — first-try
  accuracy ≥70% (≥90% if skimmed), or a recovery path (≥50% first try,
  every answer found after looking back, body genuinely read); character
  quiz ≥60%. Every failure offers a way through (look back / re-read
  slowly / re-meet characters).
- **Character archive** — status seen → familiar → mastered (right in 3
  different stories), spaced review, "where have I seen this character",
  collection cards with their source story.
- **Rewards** — bones ledger (add-only), surprise chest, puppy growth
  and accessories, quest map, medals, streak with freeze cards; parent-set
  redemption table.
- **Eye care** — session length → rest page, daily screen limit and
  bedtime → listen-only, night theme, large type.
- **Pinyin quality** — Qwen checks every polyphonic character against
  pinyin-pro's candidates (it can only choose among them; neutral tones
  such as 喜欢 xǐ huan are kept); parents fix any word (长着 = zhǎng zhe)
  and the fix applies across the library.
- **Offline** — today's opened article stays on the device; reading
  continues without network and progress syncs when it is back. Quest
  questions need the network (they are judged on the server).
- **Read-aloud** — the device's Chinese voice. MeloTTS, the only Workers AI
  model with Chinese, was retired on 2026-11-20; set `TTS_MODEL` to
  pre-generate audio again if a Chinese model appears.
- **Parent console** (`/parent.html`) — ability radar, literacy curve,
  reading history with wrong answers, suggestions, library review
  (flagged / rejected / force / pick today), textbook character lists,
  manual corrections, settings, rewards, printable monthly passport.

Phase 2 skills (unlock one every `skill_days` completed readings, after
the phase-1 ones; `skill_days: 0` unlocks all):

- **预测** — reading pauses before a turn of the story; one guess,
  revealed at the paragraph where it happens; never counts against
  completion (stories only).
- **回文定位** — an inference question answered by tapping the evidence
  sentence in the text (weight 2 in the verdict).
- **概括段意** — the model splits the article into 3–5 parts; choosing each
  part's summary assembles an article map.

Models never return answer indexes: they write the right text and the
wrong ones, and code places them (index numbering was mixed 0-/1-based in
practice). The pre-reading task comes in one object with its question.

- **语音复述** — after completing, the child retells the story aloud
  (MediaRecorder on iPad → Whisper → simplified text → Qwen checks the
  3–5 key points by meaning, so homophone errors in the transcript do not
  count against the child). ≥60% of the points = level 3 「完成复述」 +3
  bones. The only live model call on the reading path: two per session.
  `@cf/openai/whisper` (handles iPad AAC); `STT_MODEL` overrides.

- **AI 定制故事** (§11) — on demand (optionally starring the child; hero
  set in settings) or automatically when fewer than two unread articles
  suit the child (cron, max one a day). Each story targets due-review
  characters plus the next ones in textbook order; code counts the
  characters the child does not know and asks for simpler wording (≤2
  rewrites, best draft kept); then the normal pipeline screens it.

**Workers AI budget.** The free plan gives 10,000 neurons a day per
account. When it runs out (error 4006) the pipeline pauses until 00:00
UTC instead of failing articles; the parent console shows a banner and
retelling tells the child to try tomorrow.

## Development

```sh
npm install
cp .dev.vars.example .dev.vars   # PINs + AI_MOCK=1 (no Workers AI needed)
npm run db:init:local
npm run dev                      # http://localhost:8787
npm run seed                     # BASE=http://localhost:8787 — loads samples/
npm test                         # unit tests (logic, metrics, validation)
npm run smoke                    # end-to-end against a running dev server
```

With `AI_MOCK=1` the pipeline produces deterministic stub glosses and
questions so the whole loop can be exercised offline. Remove it to use
Workers AI (bills the logged-in account even in local dev).

Difficulty calibration (reproduces `difficulty-sample-2026-11-25.md`):

```sh
npm run difficulty -- samples/*.txt                       # known = 统编版 识字表 一上–四下
npm run difficulty -- --volume 4 samples/*.txt            # … up to 二下
npm run difficulty -- --known 字表.csv some/article.txt     # known = any char list
```

Traditional text is converted to simplified before any analysis; per
child an article is PASS (≤8 new chars), REVIEW (≤15) or deferred until
the known set grows — the daily pick never prefers a harder tier.

### Character data

- `src/data/textbook.js` — 统编版 (MOE) primary textbook characters per
  volume, 识字表 (recognise) and 写字表 (write), generated by
  `scripts/build-textbook.py` from the database of Zhang, Guo et al.
  (2023), *A large-scale database of Chinese characters and words
  collected from elementary school textbooks*, Behavior Research Methods,
  data at <https://osf.io/ynk8c/>. This is the primary level order:
  grade bands, the grades 1–4 coverage metric, assessment levels (one per
  volume) and teaching order all derive from it.
- `src/data/charlevels.js` — 通用规范汉字表 level 1 ordered by Jun Da's
  corpus frequency (`scripts/build-charlevels.mjs`); breaks ties inside a
  volume and orders the common characters the textbooks never teach.

## Deploy (dc2926 account)

```sh
npx wrangler login                       # as dc2926
npm run db:create                        # paste database_id into wrangler.toml
npm run db:init
npx wrangler r2 bucket create readhound-audio
npx wrangler secret put CHILD_PIN
npx wrangler secret put PARENT_PIN
npx wrangler secret put SESSION_SECRET   # long random string
npm run deploy
```

Schema changes after the first deploy live in `db/migrations/`
(`NNNN_name.sql`). Pushing to `main` runs `.github/workflows/deploy.yml`:
tests → `wrangler d1 migrations apply readhound --remote` (applies the ones
not yet recorded) → `wrangler deploy`.

Then attach the custom domain (e.g. read.404401.xyz) and add the page to
the iPad home screen.

## License

MIT © 2026 playwjj
