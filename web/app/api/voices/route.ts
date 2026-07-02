import { NextResponse } from 'next/server';
import { ensureEnv } from '@/lib/root-env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface VoiceOption { id: string; label: string }

// Default selectable ElevenLabs voices (premade public voice ids). Override by setting
// ELEVENLABS_VOICES in .env to a JSON array like [{"id":"...","label":"..."}] — no code
// change needed to add your cloned voices.
const DEFAULT_VOICES: VoiceOption[] = [
  { id: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel (warm, narration)' },
  { id: 'pNInz6obpgDQGcFmaJgB', label: 'Adam (deep, documentary)' },
  { id: 'ErXwobaYiN019PkySvjV', label: 'Antoni (calm, well-rounded)' },
  { id: 'EXAVITQu4vr4xnSDxMaL', label: 'Bella (soft, friendly)' },
];

function roster(): VoiceOption[] {
  const raw = process.env.ELEVENLABS_VOICES;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const clean = parsed.filter((v) => v && typeof v.id === 'string').map((v) => ({ id: v.id, label: String(v.label ?? v.id) }));
        if (clean.length) return clean;
      }
    } catch { /* fall through to defaults */ }
  }
  // Copy: the GET handler below may unshift into this array, and the module
  // constant must not accumulate entries across requests.
  return [...DEFAULT_VOICES];
}

// List selectable voices + which one is the current default (ELEVENLABS_VOICE_ID).
export async function GET() {
  ensureEnv();
  const voices = roster();
  const current = process.env.ELEVENLABS_VOICE_ID || voices[0]?.id || '';
  // Make sure the configured default is offered even if it isn't in the roster.
  if (current && !voices.some((v) => v.id === current)) {
    voices.unshift({ id: current, label: `Configured (${current.slice(0, 8)}…)` });
  }
  return NextResponse.json({ voices, defaultId: current });
}
