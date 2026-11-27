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
- **Parent console** (`/parent/`; `/parent.html` redirects) — ability radar, literacy curve,
  reading history with wrong answers, suggestions, library review
  (flagged / rejected / force / pick today), textbook character lists,
  manual corrections, settings, rewards, printable monthly passport.

Daily choice and question review:

- **每日二选一** — the daily pick comes with up to two alternatives from the
  same tier and close in score (a different genre where possible). Until
  today's reading starts, the child picks one on the home card
  (`POST /api/pick/choose`); a parent's 设为今日 removes the choice.
- **错题回炉** — comprehension questions missed first time in the last 14
  days come back before the next daily reading (2 a day, with the paragraph
  holding the answer; one try each, until right or 3 tries). Results go into
  the ability radar and a 错题回炉 card in the parent report.

- **闯关地图 by genre** — eight regions, each lit by reading its genres
  (神话 → 神话之河, 科普 → 科学港湾 …); every region read 3+ times adds a
  floor to 智慧高塔. A region not visited yet gives an article a small nudge
  in the daily pick, so the map also pulls toward variety.
- **我喜欢读…** — the child chooses its own interest tags once (home asks;
  changeable from the footer link). They replace the parent's choices from
  the same list; the parent's own words stay.
- **家长周报** — last week in a few lines (days read, characters, first-try
  rate vs the week before, weakest skill, one thing to try) at the top of the
  report, with a copy button; with `weekly_webhook` set (企业微信 / 钉钉 /
  飞书 bot, or any https endpoint taking `{"text": …}`) the cron pushes it
  on Monday after 08:00 (Asia/Shanghai). The report also has a 月度趋势
  table (reading days, articles, characters, first-try rate, known
  characters per month).

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

- **大声朗读** (unlocks after the first completed article; no percentage
  shown for the first 7, so a weak reader is not graded on day one) — 🎙 on any paragraph: speech recognition, then a
  toneless-pinyin alignment (LCS) with the paragraph's corrected pinyin,
  so a homophone written by the recogniser is never a reading error.
  Shows accuracy, characters per minute and the words to practise
  (tap to hear); 15 paragraphs a day; parent report shows the averages.
- **课本进度** — the child's textbook by unit (统编版/人教社 四年级, the
  2026 revision now in use): theme, 语文要素, lessons, the unit's 识字表 /
  写字表 (pasted from the book via iPad Live Text). Setting the current unit
  makes this and the next unit's characters the targets, puts earlier
  units' unknown characters into review, and leans article picks and
  generated stories to the unit's theme, genre and skill. A 四上 skeleton
  is pre-filled from published change notes, marked 待核对 until the parent
  checks it against the book.
- **AI 定制故事** (§11) — on demand (optionally starring the child; hero
  set in settings) or automatically when fewer than two unread articles
  suit the child (cron, max one a day). Each story targets due-review
  characters plus the next ones in textbook order; code counts the
  characters the child does not know and asks for simpler wording (≤2
  rewrites, best draft kept); then the normal pipeline screens it.

**Workers AI budget.** The free plan gives 10,000 neurons a day per
account. When it runs out (error 4006) the pipeline pauses until 00:00
UTC instead of failing articles; the parent console shows a banner and
retelling tells the child to try tomorrow. Every call is metered per UTC
day and purpose (report tab → AI 用量); the ingest pipeline has its own
daily call limit (`ai_daily_calls`, default 60 ≈ 10 articles) so the rest
of the allocation stays for the child's live features.

## Development

```sh
npm install
cp .dev.vars.example .dev.vars   # PINs + AI_MOCK=1 (no Workers AI needed)
npm run db:init:local
npm run dev                      # http://localhost:8787 (builds the front end first)
npm run dev:web                  # front end with hot reload: http://localhost:5173 (+ /parent/)
npm run seed                     # BASE=http://localhost:8787 — loads samples/
npm test                         # unit tests (logic, metrics, validation)
npm run smoke                    # end-to-end against a running dev server
```

Front end: Vue 3 + vue-router, built by Vite into `dist/` (not committed —
`wrangler dev`/`deploy` run `npm run build` via `[build]` in `wrangler.toml`).
`web/child/` is the child app at `/` (the reading flow in
`views/Reading.vue` runs one stage component after another), `web/parent/`
the parent console at `/parent/`, `web/shared/` what both use (styles, busy
buttons, activity bar, the hound) and `web/public/` the service worker, icons
and manifest. The service worker caches the child page and every file it
references on install, so reading works offline.

With `AI_MOCK=1` the pipeline produces deterministic stub glosses and
questions so the whole loop can be exercised offline. Remove it to use
Workers AI (bills the logged-in account even in local dev).

Note: the `[ai]` binding in `wrangler.toml` makes `wrangler dev` proxy to
Cloudflare and ask for `CLOUDFLARE_API_TOKEN` even with `AI_MOCK=1`. For a
fully offline instance, comment out the `[ai]` block locally (with
`AI_MOCK=1` the code never touches `env.AI`) and don't commit that change.

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

## Filling the library

Content goes in through the parent API, so every article passes the
normal pipeline (screening, pinyin, questions). From the parent console
(添加文章), or from a terminal with `scripts/import.mjs`:

```sh
export READHOUND_URL=https://<your-domain> PARENT_PIN=<parent pin>
node scripts/import.mjs classics idiom 10   # retell public-domain classics: idiom|myth|fable|fairy|history|science
node scripts/import.mjs urls list.txt       # web pages you choose, one URL per line, fetched every 2 s
node scripts/import.mjs txt book.txt        # "=== 标题" separated articles (family books)
```

Retold classics (成语、神话、寓言、童话、历史、科普 — 140 titles in
`src/data/classics.js`) are the quickest clean source: the model retells
each in its own words at the child's level, aiming each story at different
characters. Queued work is processed every 30 minutes within the daily AI
budget (`ai_daily_calls`, ~7–10 articles a day by default).

In the parent console (添加文章):

- **公版名篇书架** — public-domain texts suited to grade 4 (`src/data/shelf.js`:
  老舍《小坡的生日》, 夏丏尊译《爱的教育》, 许地山《落花生》, 萧红《祖父的园子》,
  朱自清, 胡适, 鲁迅 …), fetched from zh.wikisource chapter by chapter.
- **粘贴网址导入** — a story page the parent found (WeChat articles too),
  for the family's own reading.

Long texts are split into parts of about 1000 characters (`src/lib/split.js`)
that are offered in order: part n only after the earlier parts are read.

### Prepared articles (no AI wait)

Every article normally waits for Workers AI (screening, glosses, questions).
Articles can instead be prepared by hand — the same content, checked by the
same validators — and are then ready a minute after import, whatever the AI
quota says:

```sh
node scripts/prepare.mjs shelf xiaopo 1          # skeletons in data/prepared/ (never committed) + what to decide
node scripts/prepare.mjs check data/prepared/x.json   # after editing a body: readings and gloss candidates again
READHOUND_URL=https://<your-domain> PARENT_PIN=<parent pin> node scripts/import-prepared.mjs data/prepared/*.json
```

A prepared file holds the text plus `prepared`: `screen`, `polyphones`
(`"<paragraph>:<han index>": reading`), `glosses`, `questions`, `skills` in
the formats of the AI stages (`src/lib/ai.js`). The pipeline uses them in
place of the model calls and processes prepared articles first.

## Deploy

```sh
npx wrangler login
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

Then attach a custom domain and add the page to the iPad home screen.

## License

MIT © 2026 playwjj
