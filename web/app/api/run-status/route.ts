import { NextResponse } from 'next/server';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { GENERATED_DIR } from '@/lib/paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Live progress for a triggered run: tail its log, detect completion, and report
// the demo video's mtime so the dashboard can auto-load a cache-busted preview.
export async function GET(req: Request) {
  const log = new URL(req.url).searchParams.get('log') ?? '';
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
