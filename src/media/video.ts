import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { estimateShotCost } from '../skills/cost.js';
import type { MediaArtifact, ProviderInfo } from './types.js';

// AI video generation provider. Real path = Runway (api.dev.runwayml.com):
// create a text-to-video task, then poll tasks/{id} until SUCCEEDED. Falls back
// to a deterministic mock when no RUNWAY_API_KEY is set.
const log = createLogger({ mod: 'video' });
export type VideoModel = 'runway' | 'kling' | 'veo';

export type RunwayRatio = '1280:720' | '720:1280' | '1104:832' | '960:960';
export interface VideoRequest { prompt: string; model: VideoModel; durationS: number; takes?: number; seed?: number; ratio?: RunwayRatio; promptImage?: string }
export interface VideoProvider extends ProviderInfo { generate(req: VideoRequest): Promise<MediaArtifact[]> }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TRANSIENT = new Set([408, 429, 500, 502, 503, 504]);

interface RunwayTask { id: string; status: 'PENDING' | 'RUNNING' | 'THROTTLED' | 'SUCCEEDED' | 'FAILED'; output?: string[]; failure?: string; failureCode?: string }

export class RunwayVideo implements VideoProvider {
  readonly name = 'runway'; readonly live = true;
  constructor(private apiKey: string) {}

  private headers() {
    const c = config();
    return { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json', 'X-Runway-Version': c.RUNWAY_VERSION };
  }

  private async req<T>(path: string, init: RequestInit, attempts = 3): Promise<T> {
    const c = config();
    let last: unknown;
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
    throw new Error(`Runway request failed: ${String(last)}`);
  }

  private async createTask(req: VideoRequest): Promise<string> {
    const c = config();
    const duration = Math.max(2, Math.min(10, Math.round(req.durationS)));
    const body: Record<string, unknown> = { model: c.RUNWAY_MODEL, promptText: req.prompt, ratio: req.ratio ?? '1280:720', duration };
    if (req.promptImage) body.promptImage = req.promptImage;       // image-to-video when provided
    if (req.seed !== undefined) body.seed = req.seed;
    const out = await this.req<{ id: string }>('/v1/image_to_video', { method: 'POST', body: JSON.stringify(body) });
    return out.id;
  }

  private async poll(id: string): Promise<string[]> {
    const c = config();
    const deadline = Date.now() + c.RUNWAY_POLL_TIMEOUT_MS;
    let delay = 3000;
    while (Date.now() < deadline) {
      const t = await this.req<RunwayTask>(`/v1/tasks/${id}`, { method: 'GET' });
      if (t.status === 'SUCCEEDED') return t.output ?? [];
      if (t.status === 'FAILED') throw new Error(`Runway task failed: ${t.failureCode ?? ''} ${t.failure ?? ''}`.trim());
      await sleep(delay);
      delay = Math.min(delay * 1.5, 15000);
    }
    throw new Error(`Runway task ${id} timed out after ${c.RUNWAY_POLL_TIMEOUT_MS}ms`);
  }

  async generate(req: VideoRequest): Promise<MediaArtifact[]> {
    const c = config();
    const takes = Math.min(req.takes ?? 1, c.RUNWAY_MAX_TAKES); // cap real-API takes to control cost
    const perTakeCost = estimateShotCost(req.durationS, 'runway');
    const out: MediaArtifact[] = [];
    for (let i = 0; i < takes; i++) {
      const id = await this.createTask(req);
      log.info('runway task submitted', { id, take: i, duration: req.durationS });
      const urls = await this.poll(id);
      if (urls.length === 0) { log.warn('runway task returned no output', { id }); continue; }
      out.push({ uri: urls[0]!, durationS: req.durationS, costUsd: perTakeCost, meta: { take: i, taskId: id, model: c.RUNWAY_MODEL } });
    }
    if (out.length === 0) throw new Error('Runway produced no usable takes');
    return out;
  }
}

class MockVideo implements VideoProvider {
  readonly name = 'mock'; readonly live = false;
  async generate(req: VideoRequest): Promise<MediaArtifact[]> {
    const takes = req.takes ?? 2;
    return Array.from({ length: takes }, (_, i) => ({ uri: `mock://video/${req.model}/${Math.abs(hash(req.prompt))}_${i}.mp4`, durationS: req.durationS, costUsd: 0, meta: { take: i, model: req.model } }));
  }
}
function hash(s: string) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }

let provider: VideoProvider | null = null;
export function getVideo(): VideoProvider {
  if (provider) return provider;
  const c = config();
  provider = c.RUNWAY_API_KEY ? new RunwayVideo(c.RUNWAY_API_KEY) : new MockVideo();
  return provider;
}
export function __setVideo(p: VideoProvider | null) { provider = p; }
