import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { estimateImageCost } from '../skills/cost.js';
import type { MediaArtifact, ProviderInfo } from './types.js';

// Image generation provider. Real path = Runway gen4_image (text_to_image task +
// poll), reusing RUNWAY_API_KEY. Falls back to a deterministic mock. Used by
// Packaging (10) to turn thumbnail concepts into actual images.
const log = createLogger({ mod: 'image' });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TRANSIENT = new Set([408, 429, 500, 502, 503, 504]);

export interface ImageRequest { prompt: string; ratio?: string }
export interface ImageProvider extends ProviderInfo { generate(req: ImageRequest): Promise<MediaArtifact> }

interface RunwayTask { id: string; status: 'PENDING' | 'RUNNING' | 'THROTTLED' | 'SUCCEEDED' | 'FAILED'; output?: string[]; failure?: string }

export class RunwayImage implements ImageProvider {
  readonly name = 'runway'; readonly live = true;
  constructor(private apiKey: string) {}
  private headers() { const c = config(); return { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json', 'X-Runway-Version': c.RUNWAY_VERSION }; }

  private async req<T>(path: string, init: RequestInit, attempts = 3): Promise<T> {
    const c = config(); let last: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await fetch(`${c.RUNWAY_API_BASE}${path}`, { ...init, headers: this.headers() });
        if (!res.ok) {
          const body = await res.text();
          if (TRANSIENT.has(res.status) && i < attempts - 1) { await sleep(2 ** i * 700); continue; }
          throw new Error(`Runway ${res.status}: ${body.slice(0, 240)}`);
        }
        return (await res.json()) as T;
      } catch (e) { last = e; if (i < attempts - 1) await sleep(2 ** i * 700); }
    }
    throw new Error(`Runway image request failed: ${String(last)}`);
  }

  async generate(req: ImageRequest): Promise<MediaArtifact> {
    const c = config();
    const { id } = await this.req<{ id: string }>('/v1/text_to_image', {
      method: 'POST',
      body: JSON.stringify({ promptText: req.prompt, model: 'gen4_image', ratio: req.ratio ?? '1920:1080' }),
    });
    log.info('runway image task submitted', { id });
    const deadline = Date.now() + c.RUNWAY_POLL_TIMEOUT_MS;
    let delay = 2500;
    while (Date.now() < deadline) {
      const t = await this.req<RunwayTask>(`/v1/tasks/${id}`, { method: 'GET' });
      if (t.status === 'SUCCEEDED') {
        const uri = t.output?.[0];
        if (!uri) throw new Error('Runway image returned no output');
        return { uri, costUsd: estimateImageCost(), meta: { taskId: id, model: 'gen4_image' } };
      }
      if (t.status === 'FAILED') throw new Error(`Runway image failed: ${t.failure ?? ''}`);
      await sleep(delay); delay = Math.min(delay * 1.5, 12000);
    }
    throw new Error(`Runway image ${id} timed out`);
  }
}

class MockImage implements ImageProvider {
  readonly name = 'mock'; readonly live = false;
  async generate(req: ImageRequest): Promise<MediaArtifact> {
    return { uri: `mock://thumb/${Math.abs(hash(req.prompt))}.png`, costUsd: 0, meta: { model: 'mock' } };
  }
}
function hash(s: string) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }

let provider: ImageProvider | null = null;
export function getImage(): ImageProvider {
  if (provider) return provider;
  const c = config();
  provider = c.RUNWAY_API_KEY ? new RunwayImage(c.RUNWAY_API_KEY) : new MockImage();
  return provider;
}
export function __setImage(p: ImageProvider | null) { provider = p; }
