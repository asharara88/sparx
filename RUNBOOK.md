# SPARX AI YouTube Studio — Runbook

How to produce one episode, from setup to published. The pipeline runs offline on
mock data out of the box; add API keys to go live.

## 1. One-time setup
```bash
npm install
npx playwright install chromium     # only needed for browser-automation steps
# ffmpeg is bundled (ffmpeg-static) — no system install
cp .env.example .env
```

## 2. Add your keys to `.env`
| Key | Enables |
|-----|---------|
| `ANTHROPIC_API_KEY` | Real scripts, shot plans, QA, packaging (else mock) |
| `TAVILY_API_KEY` | Live web research for the Research agent |
| `ELEVENLABS_API_KEY` | Real voiceover |
| `RUNWAY_API_KEY` | Real video clips **and** thumbnails (gen4_image) |
| `HEYGEN_API_KEY` (+ `HEYGEN_AVATAR_ID`, `HEYGEN_VOICE_ID`) | Real avatar shots |
| `PEXELS_API_KEY` | Real stock b-roll |
| `YOUTUBE_ACCESS_TOKEN` | Upload (stays **private** unless you change `YOUTUBE_PRIVACY`) |
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | Persist episodes (needed for cross-session review) |

Set `AUTO_APPROVE_GATES=false` to be asked for approval at each gate (recommended for real runs).

## 3. Check readiness
```bash
npm run preflight
```
Shows which integrations are LIVE vs MOCK, and whether ffmpeg/Supabase are ready.

## 4. Produce an episode
```bash
npm run episode -- "your topic or niche"
```
Runs research → script → shot plan → voiceover/video/avatar/stock/music → render → QA → shorts → packaging → publish, printing a summary at the end.

## 5. Approve at the gates (when `AUTO_APPROVE_GATES=false`)
The run pauses and prints a review. Act on it (requires Supabase to persist across commands):
```bash
npm run review list                       # episodes awaiting review
npm run review show   <episodeId>         # see the concept / script / cut
npm run review approve <episodeId>
npm run review revise  <episodeId> "make the hook punchier"
npm run review reject  <episodeId>
```
- **Gate A** — concept/angle. **Gate B** — script + shot list (shows estimated generation cost *before* any spend). **Gate C** — final cut.

## 6. Find the outputs
With live media keys, the render lands at:
```
generated/<episodeId>/cut.mp4         # the episode
generated/<episodeId>/captions.srt    # captions
generated/<episodeId>/timeline.json   # the edit decision list
```

## 7. Publishing
With `YOUTUBE_ACCESS_TOKEN` set, Publishing uploads `cut.mp4` as **private** with full
metadata (title, tags, timestamped chapters, AI-disclosure note). Review it in YouTube
Studio and switch to public yourself — the pipeline never auto-publishes public.

## 8. Budget
`BUDGET_CAP_USD` caps monthly spend. The Visual Director downgrades AI shots to stock to
stay under budget, and Video/Avatar agents skip generation they can't afford.

## 9. Troubleshooting
- Everything says MOCK → keys aren't in `.env` (run `npm run preflight`).
- `render skipped: mock assets` → expected without media keys; add Runway/HeyGen/Pexels/ElevenLabs.
- Review CLI shows nothing → set Supabase env (in-memory store doesn't persist across commands).
- `npm test` runs the 36-test suite; `npm run inspect` prints generated concept/script/prompts.
