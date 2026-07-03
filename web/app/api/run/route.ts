import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { ensureEnv } from '@/lib/root-env';
import { REPO_ROOT, GENERATED_DIR } from '@/lib/paths';
import { getSupabase } from '@/lib/supabase';
import { enqueueJob } from '@/lib/jobs';
import { normalizeRunBody, runEnvAndArgs } from '@/lib/run-params';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Trigger a demo render or full pipeline run. Two modes:
//  · Deployed (Supabase configured): enqueue a render_jobs row and let the always-on
//    Railway worker run it — Vercel can't spawn the minutes-long ffmpeg pipeline.
//  · Local dev (no Supabase): spawn the pipeline as a detached child, as before.
// The response tells the dashboard which to poll: { jobId } vs { log }.
export async function POST(req: Request) {
  ensureEnv();
  let body = {};
  try { body = await req.json(); } catch { /* empty body ok */ }
  const { mode, params } = normalizeRunBody(body);

  const sb = getSupabase();
  if (sb) {
    try {
      const jobId = await enqueueJob(sb, mode, params);
      return NextResponse.json({ started: true, mode, jobId });
    } catch (e) {
      return NextResponse.json({ started: false, error: String(e) }, { status: 500 });
    }
  }

  // ---- Local fallback: spawn the pipeline against the repo root. ----
  const logDir = join(GENERATED_DIR, 'web-runs');
  mkdirSync(logDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = join(logDir, `${mode}-${stamp}.log`);
  const fd = openSync(logFile, 'a');

  const { env: overrides, args } = runEnvAndArgs(mode, params);
  const env: NodeJS.ProcessEnv = { ...process.env, ...overrides };

  const child = spawn('npx', args, { cwd: REPO_ROOT, env, detached: true, stdio: ['ignore', fd, fd] });
  child.unref();
  // spawn dup()ed the descriptor into the child; close the parent's copy so each
  // run doesn't leak an fd in the server process.
  closeSync(fd);

  return NextResponse.json({ started: true, mode, pid: child.pid, log: `${mode}-${stamp}.log` });
}
