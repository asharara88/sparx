import { z } from 'zod';

// Typed, validated runtime configuration. Fails fast on malformed env.
const Schema = z.object({
  // pipeline
  AUTO_APPROVE_GATES: z.enum(['true', 'false']).default('false'),
  BUDGET_CAP_USD: z.coerce.number().positive().default(500),
  CHANNEL_NICHE: z.string().default('AI tools for creators'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  LOG_FORMAT: z.enum(['pretty', 'json']).default('pretty'),

  // llm
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default('claude-sonnet-4-6'),
  LLM_FAST_MODEL: z.string().default('claude-haiku-4-5-20251001'),
  LLM_MAX_RETRIES: z.coerce.number().int().min(0).default(3),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),

  // research providers (optional; mock used when absent)
  TAVILY_API_KEY: z.string().optional(),
  BRAVE_API_KEY: z.string().optional(),

  // media providers (optional; mock used when absent)
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().default('elevenlabs:cloned_v1'),
  RUNWAY_API_KEY: z.string().optional(),
  RUNWAY_MODEL: z.string().default('gen4.5'),
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
  HEYGEN_POLL_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
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
