import { NextResponse } from 'next/server';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { GENERATED_DIR } from '@/lib/paths';
import { getSupabase } from '@/lib/supabase';
import { getJob } from '@/lib/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Live progress for a run. Deployed: poll the render_jobs row by ?job=<id>.
// Local: tail the spawned child's ?log=<name> file. Both return the same shape so
// the dashboard is agnostic; `videoId` (job) supersedes `videoMtime` (local).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const jobId = url.searchParams.get('job');

  if (jobId) {
    if (!/^[0-9a-f-]{36}$/i.test(jobId)) return NextResponse.json({ error: 'bad job id' }, { status: 400 });
    const sb = getSupabase();
    if (!sb) return NextResponse.json({ error: 'jobs unavailable' }, { status: 503 });
    let job;
    try { job = await getJob(sb, jobId); } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
    if (!job) return NextResponse.json({ running: true, done: false, ok: false, tail: '', videoId: null });
    const ok = job.status === 'done';
    const failed = job.status === 'failed';
    const done = ok || failed;
    return NextResponse.json({
      running: !done, done, ok, failed,
      tail: job.error ? `${job.log}\n${job.error}` : job.log,
      // The dashboard loads /api/video/<videoId> once a cut exists.
      videoId: ok && job.video_path ? (job.episode_id || job.id) : null,
    });
  }

  const log = url.searchParams.get('log') ?? '';
  // Guard: only a plain log filename inside generated/web-runs.
  if (!/^[A-Za-z0-9._-]+\.log$/.test(log)) return NextResponse.json({ error: 'bad log name' }, { status: 400 });

  const file = join(GENERATED_DIR, 'web-runs', log);
  if (!existsSync(file)) return NextResponse.json({ running: true, done: false, ok: false, tail: '', videoMtime: null });

  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const tail = lines.slice(-40).join('\n');

  const ok = /✅ Demo rendered|pipeline finished/.test(text);
  // Both entry points catch everything and print an explicit marker (scripts/demo.ts
  // → "demo failed:", src/index.ts → "pipeline crashed"). The line-anchored Error
  // pattern only catches a process that died before those handlers (e.g. a tsx
  // module-resolution stack). It must NOT match recoverable per-section warnings
  // like "  ⚠ section 1 Runway failed (Error: …)" — those are indented and the run
  // continues to a rendered cut, so flagging them killed the poll mid-run.
  const failed = /demo failed:|pipeline crashed|^[A-Za-z]*Error( \[\w+\])?:/m.test(text) && !ok;
  const done = ok || failed;

  const video = join(GENERATED_DIR, 'demo', 'cut.mp4');
  const videoMtime = existsSync(video) ? Math.floor(statSync(video).mtimeMs) : null;

  return NextResponse.json({ running: !done, done, ok, failed, tail, videoMtime });
}
