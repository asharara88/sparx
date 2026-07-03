import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { estimateImageCost } from '../skills/costModel.js';
import { fetchWithRetry, pollUntil } from '../util/http.js';
import type { MediaArtifact, ProviderInfo } from './types.js';

// Image generation provider. Real path = Runway gen4_image (text_to_image task +
// poll), reusing RUNWAY_API_KEY. Falls back to a deterministic mock. Used by
// Packaging (10) to turn thumbnail concepts into actual images.
const log = createLogger({ mod: 'image' });

export interface ImageRequest { prompt: string; ratio?: string }
export interface ImageProvider extends ProviderInfo { generate(req: ImageRequest): Promise<MediaArtifact> }

interface RunwayTask { id: string; status: 'PENDING' | 'RUNNING' | 'THROTTLED' | 'SUCCEEDED' | 'FAILED'; output?: string[]; failure?: string }

export class RunwayImage implements ImageProvider {
  readonly name = 'runway'; readonly live = true;
  constructor(private apiKey: string) {}
  private headers() { const c = config(); return { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json', 'X-Runway-Version': c.RUNWAY_VERSION }; }

  // Shared resilience core: per-attempt timeout, transient-only retry — a 4xx
  // throws immediately with the status instead of burning retries.
  private async req<T>(path: string, init: RequestInit): Promise<T> {
    const res = await fetchWithRetry(`${config().RUNWAY_API_BASE}${path}`, { ...init, headers: this.headers() }, { label: 'runway.image' });
    return (await res.json()) as T;
  }

  async generate(req: ImageRequest): Promise<MediaArtifact> {
    const { id } = await this.req<{ id: string }>('/v1/text_to_image', {
      method: 'POST',
      body: JSON.stringify({ promptText: req.prompt, model: 'gen4_image', ratio: req.ratio ?? '1920:1080' }),
    });
    log.info('runway image task submitted', { id });
    return pollUntil<MediaArtifact>({
      label: `runway image ${id}`,               // task id in the timeout error for crash forensics
      intervalMs: 4000,
      timeoutMs: config().RUNWAY_POLL_TIMEOUT_MS,
      check: async () => {
        const t = await this.req<RunwayTask>(`/v1/tasks/${id}`, { method: 'GET' });
        if (t.status === 'SUCCEEDED') {
          const uri = t.output?.[0];
          if (!uri) throw new Error(`Runway image ${id} returned no output`);
          return { uri, costUsd: estimateImageCost(), meta: { taskId: id, model: 'gen4_image' } };
        }
        if (t.status === 'FAILED') throw new Error(`Runway image ${id} failed: ${t.failure ?? ''}`);
        return undefined;
      },
    });
  }
}

class MockImage implements ImageProvider {
  readonly name = 'mock'; readonly live = false;
  async generate(req: ImageRequest): Promise<MediaArtifact> {
    return { uri: `mock://thumb/${Math.abs(hash(req.prompt))}.png`, costUsd: 0, license: 'mock', meta: { model: 'mock' } };
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
