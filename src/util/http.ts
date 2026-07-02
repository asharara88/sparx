import { createLogger } from '../logger.js';
import { config } from '../config.js';
import { sleep } from './concurrency.js';

// One shared HTTP resilience core. Every provider fetch goes through here so
// timeout + retry policy lives in exactly one place:
//   - per-attempt AbortController timeout (no provider call can hang forever)
//   - retry ONLY transient statuses/network errors — a 4xx is thrown immediately
//     with the response body, never blindly retried
//   - Retry-After honored when present, else capped exponential backoff + jitter

const TRANSIENT_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);
const log = createLogger({ mod: 'http' });

export class HttpError extends Error {
  constructor(readonly status: number, readonly bodySnippet: string, url: string) {
    super(`HTTP ${status} from ${url}: ${bodySnippet}`);
    this.name = 'HttpError';
  }
  get transient() { return TRANSIENT_STATUS.has(this.status); }
}

export interface FetchRetryOpts {
  timeoutMs?: number;     // per attempt; default HTTP_TIMEOUT_MS
  retries?: number;       // transient retries; default 2
  backoffBaseMs?: number; // default 500, doubles per attempt, capped at 8s
  label?: string;         // for log lines, e.g. 'elevenlabs.tts'
}

function retryAfterMs(res: Response): number | null {
  const h = res.headers.get('retry-after');
  if (!h) return null;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.min(secs * 1000, 30_000);
  const at = Date.parse(h);
  return Number.isNaN(at) ? null : Math.max(0, Math.min(at - Date.now(), 30_000));
}

/** fetch with per-attempt timeout and transient-only retry. Returns the ok Response; throws HttpError on non-2xx. */
export async function fetchWithRetry(url: string, init: RequestInit = {}, opts: FetchRetryOpts = {}): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? config().HTTP_TIMEOUT_MS;
  const retries = opts.retries ?? 2;
  const base = opts.backoffBaseMs ?? 500;
  const label = opts.label ?? new URL(url).host;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: ctrl.signal });
    } catch (err) {
      clearTimeout(timer);
      lastErr = err; // network error / timeout — transient by nature
      if (attempt < retries) {
        const backoff = Math.min(base * 2 ** attempt, 8000) + Math.random() * 250;
        log.warn('fetch failed, retrying', { label, attempt, timedOut: err instanceof Error && err.name === 'AbortError', backoff: Math.round(backoff) });
        await sleep(backoff);
        continue;
      }
      throw new Error(`${label}: fetch failed after ${retries + 1} attempts: ${String(err)}`);
    }
    clearTimeout(timer);

    if (res.ok) return res;

    // Status check OUTSIDE any catch: non-transient statuses throw immediately.
    const body = (await res.text().catch(() => '')).slice(0, 300);
    const err = new HttpError(res.status, body, url);
    if (!err.transient || attempt === retries) throw err;
    const backoff = retryAfterMs(res) ?? Math.min(base * 2 ** attempt, 8000) + Math.random() * 250;
    log.warn('transient http status, retrying', { label, status: res.status, attempt, backoff: Math.round(backoff) });
    await sleep(backoff);
    lastErr = err;
  }
  throw lastErr instanceof Error ? lastErr : new Error(`${label}: exhausted retries`);
}

export interface PollOpts<T> {
  intervalMs: number;
  timeoutMs: number;
  label?: string;
  /** return a value to finish, undefined to keep polling; throw to abort */
  check: () => Promise<T | undefined>;
}

/** Poll `check` on an interval until it yields a value or the deadline passes. */
export async function pollUntil<T>(opts: PollOpts<T>): Promise<T> {
  const deadline = Date.now() + opts.timeoutMs;
  while (true) {
    const v = await opts.check();
    if (v !== undefined) return v;
    if (Date.now() + opts.intervalMs > deadline) {
      throw new Error(`${opts.label ?? 'poll'}: timed out after ${opts.timeoutMs}ms`);
    }
    await sleep(opts.intervalMs);
  }
}
