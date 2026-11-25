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

Proposal approved 2026-11-25; this is the project skeleton. The full
design (in Chinese) is in [PROPOSAL.md](PROPOSAL.md).

Phase 1: baseline character assessment → corpus ingest → suitability
engine → preparation layer → reading flow (first three skills) → quest
map → progress tracking & parent report → eye-care design.

## License

MIT © 2026 playwjj
