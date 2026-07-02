import type { ZodType } from 'zod';
import { config } from '../config.js';
import { createLogger, type Logger } from '../logger.js';
import { LLMError, ValidationError } from '../errors.js';
import { costFor } from './pricing.js';

export interface Usage { inputTokens: number; outputTokens: number; costUsd: number }

export interface CompleteArgs<T = unknown> {
  system: string;
  prompt: string;
  mock: string;                 // deterministic fallback when no API key
  schema?: ZodType<T, any, any>; // when set, output is parsed + validated (with one repair pass); input type floats so transform/refine schemas work
  tier?: 'main' | 'fast' | 'pro';
  model?: string;               // explicit model override; takes precedence over tier (e.g. A/B tests)
  maxTokens?: number;
  temperature?: number;
  logger?: Logger;
}

export interface CompleteResult<T = unknown> {
  text: string;
  data: T | undefined;
  usage: Usage;
  live: boolean;
}

const TRANSIENT = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Models that reject the `temperature` parameter (deprecated / fixed for them).
// Sending it returns HTTP 400, so we omit it for these and let the model default.
function modelSupportsTemperature(model: string): boolean {
  return !/opus-4-8|fable-5|mythos-5/i.test(model);
}

// Fable 5 has always-on thinking (thinking tokens count toward max_tokens) and safety
// classifiers that can decline a request. We run it at max effort and opt into the
// server-side Opus fallback so a false-positive refusal re-serves instead of failing.
function isFable(model: string): boolean {
  return /fable-5|mythos-5/i.test(model);
}

export interface LLM {
  readonly live: boolean;
  complete<T = unknown>(args: CompleteArgs<T>): Promise<CompleteResult<T>>;
  totalUsage(): Usage;
}

class AnthropicLLM implements LLM {
  readonly live = true;
  private total: Usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  constructor(private apiKey: string, private log: Logger) {}

  totalUsage() { return { ...this.total }; }

  private model(tier: 'main' | 'fast' | 'pro') {
    const c = config();
    if (tier === 'fast') return c.LLM_FAST_MODEL;
    if (tier === 'pro') return c.LLM_PRO_MODEL;
    return c.LLM_MODEL;
  }

  private async call(model: string, system: string, prompt: string, maxTokens: number, temperature: number): Promise<{ text: string; usage: Usage; truncated: boolean }> {
    const c = config();
    let lastErr: unknown;
    for (let attempt = 0; attempt <= c.LLM_MAX_RETRIES; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), c.LLM_TIMEOUT_MS);
      try {
        const reqBody: Record<string, unknown> = { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }] };
        // Some newer models (e.g. Opus 4.8, Fable 5) deprecate `temperature` and 400 if it's sent.
        if (modelSupportsTemperature(model)) reqBody.temperature = temperature;
        const headers: Record<string, string> = { 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
        if (isFable(model)) {
          reqBody.output_config = { effort: 'max' };
          reqBody.fallbacks = [{ model: 'claude-opus-4-8' }];
          headers['anthropic-beta'] = 'server-side-fallback-2026-06-01';
        }
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          signal: ctrl.signal,
          headers,
          body: JSON.stringify(reqBody),
        });
        if (!res.ok) {
          const body = await res.text();
          if (TRANSIENT.has(res.status) && attempt < c.LLM_MAX_RETRIES) {
            const backoff = Math.min(2 ** attempt * 500, 8000) + Math.random() * 250;
            this.log.warn('llm transient error, retrying', { status: res.status, attempt, backoff: Math.round(backoff) });
            await sleep(backoff);
            continue;
          }
          throw new LLMError(`Anthropic ${res.status}: ${body.slice(0, 300)}`, TRANSIENT.has(res.status));
        }
        const data = (await res.json()) as { content: { text?: string }[]; stop_reason?: string; stop_details?: { category?: string | null; explanation?: string | null } | null; model?: string; usage?: { input_tokens: number; output_tokens: number } };
        // Fable 5 safety classifiers return HTTP 200 with stop_reason "refusal" (content is
        // empty or a discarded partial). With the fallback opted in above, seeing this means
        // the whole chain declined — not retryable with the same prompt.
        if (data.stop_reason === 'refusal') {
          throw new LLMError(`Anthropic refusal (category=${data.stop_details?.category ?? 'unknown'}): ${data.stop_details?.explanation ?? 'request declined by safety classifiers'}`, false);
        }
        const text = data.content.map((p) => p.text ?? '').join('').trim();
        const truncated = data.stop_reason === 'max_tokens';
        if (truncated) this.log.warn('llm response hit max_tokens (truncated)', { model, maxTokens });
        const inTok = data.usage?.input_tokens ?? 0, outTok = data.usage?.output_tokens ?? 0;
        // Price against the model that actually served the response — on a Fable refusal
        // the server-side fallback re-serves on Opus, billed at Opus rates.
        const usage: Usage = { inputTokens: inTok, outputTokens: outTok, costUsd: costFor(data.model ?? model, inTok, outTok) };
        this.total.inputTokens += inTok; this.total.outputTokens += outTok; this.total.costUsd += usage.costUsd;
        return { text, usage, truncated };
      } catch (err) {
        // Non-retryable failures (4xx, safety refusals) won't change on a re-send.
        if (err instanceof LLMError && !err.retryable) throw err;
        lastErr = err;
        const aborted = err instanceof Error && err.name === 'AbortError';
        if (attempt < c.LLM_MAX_RETRIES) {
          const backoff = Math.min(2 ** attempt * 500, 8000) + Math.random() * 250;
          this.log.warn('llm call failed, retrying', { aborted, attempt, backoff: Math.round(backoff) });
          await sleep(backoff);
          continue;
        }
      } finally {
        clearTimeout(timer);
      }
    }
    throw new LLMError(`LLM call failed after retries: ${String(lastErr)}`, true, lastErr);
  }

  async complete<T>(args: CompleteArgs<T>): Promise<CompleteResult<T>> {
    const model = args.model ?? this.model(args.tier ?? 'main');
    const sys = args.schema ? `${args.system}\n\nRespond with ONLY valid JSON matching the requested shape. No prose, no code fences.` : args.system;
    // Fable 5 thinking is always on and its tokens count toward max_tokens; callers size
    // budgets for the visible output, so give the thinking room on top (still < ~16K,
    // the safe ceiling for non-streaming requests).
    const budget = (args.maxTokens ?? 2000) + (isFable(model) ? 8000 : 0);
    const { text, usage, truncated } = await this.call(model, sys, args.prompt, budget, args.temperature ?? 0.7);

    if (!args.schema) return { text, data: undefined, usage, live: true };

    // parse + validate, with a single repair attempt
    const first = tryValidate(text, args.schema);
    if (first.ok) return { text, data: first.data, usage, live: true };

    // If the first reply was cut off by the token cap, repairing at the same budget
    // would truncate again — give the repair more room.
    const repairBudget = truncated ? Math.min(budget * 2, 16000) : budget;
    this.log.warn('llm json failed validation, repairing', { error: first.error, truncated, repairBudget });
    const repairPrompt = truncated
      ? `${args.prompt}\n\nYour previous reply was cut off before the JSON closed. Return the COMPLETE, valid JSON only — be more concise so it fits.`
      : `${args.prompt}\n\nYour previous reply was invalid: ${first.error}\nReturn corrected JSON only.`;
    const repaired = await this.call(model, sys, repairPrompt, repairBudget, 0);
    const second = tryValidate(repaired.text, args.schema);
    const usage2: Usage = { inputTokens: usage.inputTokens + repaired.usage.inputTokens, outputTokens: usage.outputTokens + repaired.usage.outputTokens, costUsd: usage.costUsd + repaired.usage.costUsd };
    if (second.ok) return { text: repaired.text, data: second.data, usage: usage2, live: true };
    throw new ValidationError(`LLM output failed schema validation after repair: ${second.error}`);
  }
}

class MockLLM implements LLM {
  readonly live = false;
  totalUsage(): Usage { return { inputTokens: 0, outputTokens: 0, costUsd: 0 }; }
  async complete<T>(args: CompleteArgs<T>): Promise<CompleteResult<T>> {
    const usage: Usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
    if (!args.schema) return { text: args.mock, data: undefined, usage, live: false };
    const v = tryValidate(args.mock, args.schema);
    if (!v.ok) throw new ValidationError(`Mock for a schema'd call is itself invalid: ${v.error}`);
    return { text: args.mock, data: v.data, usage, live: false };
  }
}

function tryValidate<T>(raw: string, schema: ZodType<T, any, any>): { ok: true; data: T } | { ok: false; error: string } {
  let parsed: unknown;
  try { parsed = JSON.parse(extractJson(raw)); }
  catch (e) { return { ok: false, error: `not JSON: ${String(e)}` }; }
  const r = schema.safeParse(parsed);
  if (r.success) return { ok: true, data: r.data };
  return { ok: false, error: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
}

export function extractJson(raw: string): string {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1]!.trim();
  const start = s.search(/[[{]/);
  if (start > 0) s = s.slice(start);
  return s;
}

let singleton: LLM | null = null;
export function getLLM(): LLM {
  if (singleton) return singleton;
  const c = config();
  const log = createLogger({ mod: 'llm' });
  singleton = c.ANTHROPIC_API_KEY ? new AnthropicLLM(c.ANTHROPIC_API_KEY, log) : new MockLLM();
  return singleton;
}

// test seam
export function __setLLM(l: LLM | null) { singleton = l; }
