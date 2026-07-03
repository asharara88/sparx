# Deploying sparx (Vercel + Railway + Supabase)

The dashboard is a Next.js app; the pipeline is a minutes-long ffmpeg job. Vercel
can't run the pipeline (serverless functions are short-lived and have no ffmpeg or
persistent disk), so the system splits in three:

```
  Browser ──▶ Vercel (dashboard + API)
                 │  enqueue job
                 ▼
             Supabase  ◀── Postgres queue (render_jobs) + Storage (renders bucket)
                 ▲                              │ claim job
                 │  upload cut, update status   ▼
             Railway worker ─── runs the pipeline + ffmpeg (always-on)
```

- **Vercel** hosts the dashboard and the API routes. `/api/run` inserts a `render_jobs`
  row; `/api/run-status` polls it; `/api/video/[id]` redirects to a signed Storage URL.
- **Railway** runs the always-on worker (`npm run worker`) that claims jobs, runs the
  pipeline (HeyGen / Runway / ElevenLabs / ffmpeg), uploads the cut to Storage, and marks
  the job done.
- **Supabase** is the shared queue + state + video storage.

> Local dev is unchanged: with no `SUPABASE_URL`, `/api/run` falls back to spawning the
> pipeline directly and serving `generated/<id>/cut.mp4` from disk. You only need the
> steps below for the hosted deployment.

---

## 1. Supabase

1. Create a project at supabase.com (or reuse the one already wired for episode state).
2. Run the migrations in `supabase/migrations/` in order (SQL Editor, or the Supabase CLI
   `supabase db push`). `0002_render_jobs.sql` creates the `render_jobs` queue, the
   `claim_render_job` / `requeue_stale_jobs` functions, the `episodes.video_path` column,
   and the private `renders` Storage bucket.
3. From **Project Settings → API**, copy the **Project URL** and the **service_role** key.
   Both the worker and Vercel use the service role (it bypasses RLS to sign URLs and drain
   the queue) — keep it server-side only, never in client code.

## 2. Railway worker

1. New project → **Deploy from GitHub repo** → pick this repo. Railway detects
   `railway.json` and builds the root `Dockerfile` (Node 20 + ffmpeg).
2. Set the service's **Variables** (see the matrix below) — at minimum `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, and the provider keys you want live.
3. Deploy. The logs should show `worker <host>#<pid> online; draining render_jobs…`.
   Scale by running more than one instance — `claim_render_job` uses `FOR UPDATE SKIP
   LOCKED`, so workers never grab the same job.

## 3. Vercel dashboard

1. New project → import this repo → set **Root Directory** to `web`. `web/vercel.json`
   pins the Next.js framework and the video route's `maxDuration`.
2. Set the environment variables (matrix below): `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
   at minimum, plus the provider keys so the Setup page's status chips read correctly.
3. Deploy. Trigger a run from the dashboard — it enqueues a job; the Railway worker picks
   it up; the preview loads from Storage when it finishes.

---

## Environment variable matrix

| Variable | Vercel | Railway worker | Purpose |
|---|:---:|:---:|---|
| `SUPABASE_URL` | ✅ | ✅ | queue + storage + episode state |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | ✅ | server-side Supabase access (sign URLs, drain queue) |
| `ANTHROPIC_API_KEY` | — | ✅ | real script/QA/packaging (mock without it) |
| `HEYGEN_API_KEY` (+ `HEYGEN_AVATAR_ID`, `HEYGEN_VOICE_ID`) | ⚪ | ✅ | avatar video |
| `ELEVENLABS_API_KEY` (+ `ELEVENLABS_VOICE_ID`) | ⚪ | ✅ | voiceover + avatar lip-sync |
| `RUNWAY_API_KEY` | ⚪ | ✅ | AI b-roll |
| `PEXELS_API_KEY` | ⚪ | ✅ | stock footage |
| `AVATAR_VOICE` | ⚪ | ✅ | `auto`\|`elevenlabs`\|`heygen` lip-sync source |
| `LLM_EFFORT` / `LLM_SCHEMA_EFFORT` | — | ✅ | reasoning-model effort (schema calls stay `low`) |
| `YOUTUBE_*` | — | ✅ | publishing (optional) |

✅ required · ⚪ optional (the worker does the real work; Vercel only needs provider keys so
the Setup chips reflect what's configured) · — not used

Everything provider-side is optional — a blank key falls back to a mock, so the pipeline
still completes end-to-end (placeholder media). The one thing both hosts must share is the
Supabase URL + service role key.

---

## Notes

- **Videos** are stored at `renders/<episodeId or jobId>.mp4` in the private bucket and
  served via short-lived signed URLs from `/api/video/[id]` — never from Vercel's disk.
- **Crash recovery**: on startup the worker calls `requeue_stale_jobs`, so a job whose
  worker died mid-render (deploy/restart) is re-queued instead of wedging as `running`.
- **Runway credits are separate from the web subscription** — `Runway 400: not enough
  credits` means the API balance at dev.runwayml.com is empty; top it up or use the HeyGen
  engine. The pipeline degrades to caption slates rather than failing the run.
