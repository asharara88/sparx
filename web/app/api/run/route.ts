import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { ensureEnv } from '@/lib/root-env';
import { REPO_ROOT, GENERATED_DIR } from '@/lib/paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Trigger a pipeline run (full episode) or a quick demo:video render. The child runs
// detached against the repo root; it loads its own .env and writes state to Supabase,
// which the dashboard polls. Output is appended to generated/web-runs/<ts>.log.
export async function POST(req: Request) {
  ensureEnv();
  let body: { mode?: string; topic?: string; sections?: number; demoMode?: string; autoApprove?: boolean; avatarId?: string; hostMode?: string } = {};
  try { body = await req.json(); } catch { /* empty body ok */ }

  const mode = body.mode === 'demo' ? 'demo' : 'pipeline';
  const logDir = join(GENERATED_DIR, 'web-runs');
  mkdirSync(logDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = join(logDir, `${mode}-${stamp}.log`);
  const fd = openSync(logFile, 'a');

  let args: string[];
  const env: NodeJS.ProcessEnv = { ...process.env };
  // Per-run avatar override: wins over .env because the child's dotenv won't override
  // an already-set process env var. Validate to a simple id to avoid shell/inject surprises.
  if (body.avatarId && /^[A-Za-z0-9._-]+$/.test(body.avatarId)) env.HEYGEN_AVATAR_ID = body.avatarId;
  if (mode === 'demo') {
    const topic = (body.topic ?? '').toString().slice(0, 300) || 'Three AI tools every creator should try';
    env.DEMO_SECTIONS = String(Math.max(1, Math.min(6, Number(body.sections) || 3)));
    if (['avatar', 'voiceover', 'broll'].includes(body.demoMode ?? '')) env.DEMO_MODE = body.demoMode;
    args = ['tsx', 'scripts/demo.ts', topic];
  } else {
    env.AUTO_APPROVE_GATES = body.autoApprove ? 'true' : 'false';
    if (body.hostMode === 'avatar' || body.hostMode === 'voice_only') env.HOST_MODE = body.hostMode;
    args = ['tsx', 'src/index.ts'];
  }

  const child = spawn('npx', args, { cwd: REPO_ROOT, env, detached: true, stdio: ['ignore', fd, fd] });
  child.unref();

  // Return the log basename so the dashboard can poll /api/run-status for live progress.
  return NextResponse.json({ started: true, mode, pid: child.pid, log: `${mode}-${stamp}.log` });
}
