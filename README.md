# sparx — AI YouTube Studio

A semi-autonomous multi-agent pipeline that researches, scripts, voices, renders, and
(optionally) publishes a YouTube episode + Shorts. Built in TypeScript on Node 20+,
with Supabase for episode state and ffmpeg for final video rendering.

Providers are optional: any API key left blank falls back to a deterministic **mock**,
so the whole pipeline runs end-to-end with no keys at all (placeholder media + silent
voice). Add keys to upgrade each stage to real output.

## Quick start

```bash
npm install
cp .env.example .env        # then fill in any keys you have (all optional)
npm test                    # full suite
npm run dev                 # run the full pipeline (holds at gate A for review)
npm run dev -- "topic"      # seed the episode with a requested topic
AUTO_APPROVE_GATES=true npm run dev   # run unattended through every stage

# gate decisions on a held episode (persists via Supabase):
npm run dev -- --resume <episode_id> --approve
npm run dev -- --resume <episode_id> --revise "shorter hook, cut section 3"
npm run dev -- --resume <episode_id> --reject
```

The pipeline writes its rendered video to `generated/<episode_id>/cut.mp4`.

## Render a demo video from a script

`demo:video` writes a short script with the LLM and renders a captioned mp4 in one step:

```bash
DEMO_SECTIONS=3 npm run demo:video -- "Three AI tools every creator should try"
#   → generated/demo/cut.mp4   (1280×720, the script burned in as on-screen captions)
```

- **Avatar mode** (default when `HEYGEN_API_KEY` is set): your HeyGen avatar speaks each
  section on camera, in your own voice.
- **Voiceover mode** (`DEMO_MODE=voiceover`): ElevenLabs narration over caption slates
  (silent if no `ELEVENLABS_API_KEY`).

Force a mode with `DEMO_MODE=avatar|voiceover`, and section count with `DEMO_SECTIONS=1..6`.

## Environment keys

Everything is optional — blanks fall back to mocks. See [.env.example](.env.example) for the full list.

| Key | Enables | Without it |
|-----|---------|-----------|
| `ANTHROPIC_API_KEY` | real LLM (script/QA/packaging) | mock script |
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | persistent episode state | in-memory store |
| `HEYGEN_API_KEY` (+ `HEYGEN_AVATAR_ID`, `HEYGEN_VOICE_ID`) | talking-head avatar video | mock / silent |
| `ELEVENLABS_API_KEY` (+ `ELEVENLABS_VOICE_ID`) | voiceover audio | silent |
| `RUNWAY_API_KEY` | AI-generated b-roll | placeholder slate |
| `PEXELS_API_KEY` | stock footage/images | placeholder |
| `YOUTUBE_CLIENT_ID` + `_SECRET` + `_REFRESH_TOKEN` | durable upload (auto-refresh) | mock upload |
| `YOUTUBE_ACCESS_TOKEN` | one-off upload (~1h token) | mock upload |

> **Secrets never get committed** — `.env` is gitignored. Only `.env.example` (no values) is tracked.

## Web dashboard

A Next.js dashboard lives in [web/](web/): trigger runs (full pipeline or `demo:video`),
watch episode state live (from Supabase), see which providers are configured, and preview
the rendered `cut.mp4` in-browser.

```bash
cd web
npm install
npm run dev          # http://localhost:3000
```

The dashboard reads the pipeline's secrets from the repo-root `.env` automatically and
triggers runs as detached child processes against the repo root. It needs Supabase
configured to list episodes; demo renders work regardless and appear in the preview pane.

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | run the full pipeline |
| `npm run demo:video -- "topic"` | render a short captioned demo from a generated script |
| `npm test` / `npm run typecheck` | tests / type check |
| `npx tsx scripts/db-check.ts` | Supabase connectivity probe |
| `npm run inspect` | inspect a generated episode |

## Architecture

A `Producer` drives an episode through a state machine ([src/producer/stateMachine.ts](src/producer/stateMachine.ts)):
research → script + **fact-check** (gates A/B) → media generation → assemble +
**captions** + **render** + **render QC** → QA (gate C) → package → publish +
**shorts render**. Each stage runs one or more agents ([src/agents/](src/agents/))
declared via `defineAgent` — declarative skills/reads/writes, enforced write
whitelists, an error boundary, and per-run timing ([src/agents/core.ts](src/agents/core.ts)).
Agents call reusable, registered **skills** ([src/skills/](src/skills/)); media providers
([src/media/](src/media/)) each have a real and a mock implementation. Per-item provider
work (sections, shots, thumbnails) runs in bounded parallel (`MEDIA_CONCURRENCY`), and a
content-keyed artifact cache stops retries from re-billing identical inputs. After
publish, `npm run analytics -- <episode_id>` folds performance into a cross-episode
channel memory that research and packaging read next time.

Framework guide: [docs/Agent-Framework.md](docs/Agent-Framework.md) ·
Full design: [docs/YouTube-Studio-Build-Spec.md](docs/YouTube-Studio-Build-Spec.md).

## Requirements

- Node 20+
- `ffmpeg` / `ffprobe` on PATH (for real rendering; the render step is skipped gracefully if absent)
