import { z } from 'zod';

// Typed, validated runtime configuration. Fails fast on malformed env.
const Schema = z.object({
  // pipeline
  AUTO_APPROVE_GATES: z.enum(['true', 'false']).default('false'),
  BUDGET_CAP_USD: z.coerce.number().positive().default(500),
  CHANNEL_NICHE: z.string().default('AI tools for creators'),
  HOST_MODE: z.enum(['real_face', 'voice_only', 'avatar', 'mixed']).default('avatar'), // 'avatar' = full talking-head narration (HeyGen carries voice)
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  LOG_FORMAT: z.enum(['pretty', 'json']).default('pretty'),
  RENDER_FAKE: z.enum(['true', 'false']).default('false'), // skip ffmpeg in the render agent (tests/dev only)

  // performance / resilience
  MEDIA_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(4), // per-agent parallel provider calls (sections/shots/clips)
  HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),  // per-attempt timeout for all provider fetches
  ARTIFACT_CACHE: z.enum(['true', 'false']).default('true'),            // content-keyed cache: skip re-paying providers for identical inputs
  CACHE_DIR: z.string().default('generated/.cache'),
  CHANNEL_MEMORY_PATH: z.string().default('generated/channel-memory.json'), // cross-episode store (topics, titles, analytics)

  // llm
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default('claude-opus-4-8'),        // 'main' tier — quality-first for non-creative agents (qa/shorts/etc.)
  LLM_FAST_MODEL: z.string().default('claude-sonnet-5'),   // 'fast' tier — grading/critique/topic refinement; near-Opus quality, still quick
  LLM_PRO_MODEL: z.string().default('claude-fable-5'),     // 'pro' tier — Fable 5 at max effort, for the creative spine (angle, script, packaging)
  LLM_MAX_RETRIES: z.coerce.number().int().min(0).default(3),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000), // Fable 5 turns at high effort can run minutes; 60s would abort every hard call

  // research providers (optional; mock used when absent)
  TAVILY_API_KEY: z.string().optional(),
  BRAVE_API_KEY: z.string().optional(),

  // media providers (optional; mock used when absent)
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().default('21m00Tcm4TlvDq8ikWAM'),   // Rachel (premade); swap for a cloned voice id
  RUNWAY_API_KEY: z.string().optional(),
  RUNWAY_MODEL: z.string().default('gen4.5'),
  RUNWAY_IMAGE_MODEL: z.string().default('gen4_image'),  // text→image step that seeds image-to-video
  RUNWAY_API_BASE: z.string().url().default('https://api.dev.runwayml.com'),
  RUNWAY_VERSION: z.string().default('2024-11-06'),
  RUNWAY_POLL_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  RUNWAY_MAX_TAKES: z.coerce.number().int().min(1).max(4).default(1),
  KLING_API_KEY: z.string().optional(),
  PEXELS_API_KEY: z.string().optional(),
  HEYGEN_API_KEY: z.string().optional(),
  HEYGEN_AVATAR_ID: z.string().default(''),
  HEYGEN_VOICE_ID: z.string().default(''),
  HEYGEN_API_BASE: z.string().url().default('https://api.heygen.com'),
  HEYGEN_UPLOAD_BASE: z.string().url().default('https://upload.heygen.com'),
  HEYGEN_POLL_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  AVATAR_VOICE: z.enum(['auto', 'heygen', 'elevenlabs']).default('auto'), // avatar lip-sync source: 'elevenlabs' narrates with your ElevenLabs voice (uploaded to HeyGen), 'heygen' uses HeyGen TTS, 'auto' prefers ElevenLabs when keyed
  YOUTUBE_ACCESS_TOKEN: z.string().optional(),           // static OAuth token (~1h); for one-off tests
  YOUTUBE_CLIENT_ID: z.string().optional(),              // OAuth client for durable refresh-token flow
  YOUTUBE_CLIENT_SECRET: z.string().optional(),
  YOUTUBE_REFRESH_TOKEN: z.string().optional(),
  YOUTUBE_CATEGORY_ID: z.string().default('27'),         // 27 = Education
  YOUTUBE_PRIVACY: z.enum(['private', 'unlisted', 'public']).default('private'),

  // supabase
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_PUBLISHABLE_KEY: z.string().optional(),

  // browser
  PLAYWRIGHT_MODE: z.enum(['headless', 'headed']).default('headless'),
  CHROME_CDP_ENDPOINT: z.string().optional(),
});

export type Config = z.infer<typeof Schema>;

let cached: Config | null = null;
export function config(): Config {
  if (cached) return cached;
  const parsed = Schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export const isTruthy = (v: 'true' | 'false') => v === 'true';
