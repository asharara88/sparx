import { NextResponse } from 'next/server';
import { ensureEnv } from '@/lib/root-env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Report which providers are configured — booleans only, never the secret values.
export async function GET() {
  ensureEnv();
  const has = (k: string) => Boolean(process.env[k] && process.env[k]!.trim());
  return NextResponse.json({
    providers: [
      { key: 'LLM (Anthropic)', env: 'ANTHROPIC_API_KEY', configured: has('ANTHROPIC_API_KEY') },
      { key: 'Supabase', env: 'SUPABASE_SERVICE_ROLE_KEY', configured: has('SUPABASE_URL') && (has('SUPABASE_SERVICE_ROLE_KEY') || has('SUPABASE_PUBLISHABLE_KEY')) },
      { key: 'HeyGen avatar', env: 'HEYGEN_API_KEY', configured: has('HEYGEN_API_KEY') },
      { key: 'ElevenLabs voice', env: 'ELEVENLABS_API_KEY', configured: has('ELEVENLABS_API_KEY') },
      { key: 'Runway video', env: 'RUNWAY_API_KEY', configured: has('RUNWAY_API_KEY') },
      { key: 'Pexels stock', env: 'PEXELS_API_KEY', configured: has('PEXELS_API_KEY') },
      { key: 'YouTube upload', env: 'YOUTUBE_REFRESH_TOKEN', configured: (has('YOUTUBE_CLIENT_ID') && has('YOUTUBE_CLIENT_SECRET') && has('YOUTUBE_REFRESH_TOKEN')) || has('YOUTUBE_ACCESS_TOKEN') },
    ],
  });
}
