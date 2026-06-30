# Local demo run — generate a single demo video on your laptop

This branch is set up to render one demo video end-to-end on your machine.
The remote Claude sandbox cannot reach ElevenLabs / Runway / HeyGen / YouTube
through its proxy, so the pipeline must run locally.

## Prerequisites

- Node.js 20+ (`node --version`)
- ffmpeg on PATH (`ffmpeg -version`)
  - macOS: `brew install ffmpeg`
  - Ubuntu/Debian: `sudo apt-get install -y ffmpeg`

## Steps

```bash
# 1. Get the latest branch
git fetch origin
git checkout claude/sparx-sharara-orient-v3q341
git pull origin claude/sparx-sharara-orient-v3q341

# 2. Install deps
npm install

# 3. Create .env from the template, then paste your keys into it
cp .env.example .env
# Edit .env in your editor and fill in the slots below.

# 4. Run the demo
npm run demo:video
```

The renderer writes `generated/demo/cut.mp4`. Open it.

## .env slots that must be filled

These are the only slots the demo script reads. Other slots are for the full
producer pipeline and can stay blank for a single demo render.

| Slot | Required for demo | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | LLM writes the script |
| `LLM_MODEL` | yes | default `claude-sonnet-4-6` is fine |
| `HEYGEN_API_KEY` | avatar mode | needed for talking-head video |
| `HEYGEN_AVATAR_ID` | avatar mode | your avatar |
| `HEYGEN_VOICE_ID` | avatar mode | voice the avatar uses |
| `ELEVENLABS_API_KEY` | voiceover mode | TTS narration |
| `ELEVENLABS_VOICE_ID` | voiceover mode | which voice to use |
| `SUPABASE_URL` | optional | persists run to DB; demo works without it |
| `SUPABASE_SERVICE_ROLE_KEY` | optional | same |

Demo mode is auto-selected: if `HEYGEN_API_KEY` is set, it uses avatar mode;
otherwise it falls back to voiceover. Force one with `DEMO_MODE=avatar` or
`DEMO_MODE=voiceover`.

## Defaults baked into this branch

- **Topic** (`scripts/demo.ts:16`):
  *"5 newborn-care mistakes new parents make — and the old advice doctors now warn against"*
- **Section count** (`scripts/demo.ts:17`): 5

Override either at runtime:

```bash
# Custom topic
npm run demo:video -- "Your topic here"

# Fewer sections (cheaper / shorter)
DEMO_SECTIONS=3 npm run demo:video

# Force voiceover even if HeyGen key is set
DEMO_MODE=voiceover npm run demo:video
```

## What to expect

- LLM writes a 5-section script (~30–60s of LLM call).
- HeyGen renders 5 talking-head clips. Each clip is one API submit + poll;
  ~30–90s per clip depending on HeyGen load. Total ~3–10 minutes.
- ffmpeg concatenates them with captioned intro/outro slates.
- Final MP4 lands at `generated/demo/cut.mp4`, ~1–3 minutes long.

**Rough cost per demo run:** Anthropic ~$0.05, HeyGen ~$2–10 for 5 sections,
ElevenLabs ~$0 (avatar mode doesn't call it). YouTube upload is OFF unless
you fill the `YOUTUBE_*` slots; `YOUTUBE_PRIVACY=private` so it cannot
go public by accident.

## If something breaks

- **`ffmpeg not available; skipping real render`** — install ffmpeg, re-run.
- **HeyGen 401 / 403** — check the API key in `.env`; not the avatar/voice ID.
- **HeyGen take stuck `processing`** — `HEYGEN_POLL_TIMEOUT_MS=300000` (5 min)
  is the cap. Raise it if your account is on a slow queue.
- **ElevenLabs 404** — bad `ELEVENLABS_VOICE_ID`. List your voices:
  `curl -H "xi-api-key: $ELEVENLABS_API_KEY" https://api.elevenlabs.io/v1/voices`.
- **Supabase persistence skipped** — `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`
  missing in `.env`. The demo still produces a video; only the DB write is skipped.
