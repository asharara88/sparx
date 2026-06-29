import { NextResponse } from 'next/server';
import { ensureEnv } from '@/lib/root-env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface AvatarOption { id: string; label: string }

// Default selectable HeyGen avatars. Override by setting HEYGEN_AVATARS in .env to a
// JSON array like [{"id":"...","label":"..."}] — no code change needed to add/rename.
const DEFAULT_AVATARS: AvatarOption[] = [
  { id: 'f5f59b95a7db4fc68db96e98a76cd955', label: 'Avatar 1' },
  { id: '6c6da497880347ab856a5a8a415cbee2', label: 'Avatar 2' },
  { id: '0344ecb550dd46dda9e9b35b63664a52', label: 'Ahmed Sharara' },
];

function roster(): AvatarOption[] {
  const raw = process.env.HEYGEN_AVATARS;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const clean = parsed.filter((a) => a && typeof a.id === 'string').map((a) => ({ id: a.id, label: String(a.label ?? a.id) }));
        if (clean.length) return clean;
      }
    } catch { /* fall through to defaults */ }
  }
  return DEFAULT_AVATARS;
}

// List selectable avatars + which one is the current default (HEYGEN_AVATAR_ID).
export async function GET() {
  ensureEnv();
  const avatars = roster();
  const current = process.env.HEYGEN_AVATAR_ID || avatars[0]?.id || '';
  // Make sure the configured default is offered even if it isn't in the roster.
  if (current && !avatars.some((a) => a.id === current)) {
    avatars.unshift({ id: current, label: `Configured (${current.slice(0, 8)}…)` });
  }
  return NextResponse.json({ avatars, defaultId: current });
}
