import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { estimateImageCost, estimateShotCost } from '../skills/costModel.js';
import { settleLimit } from '../util/concurrency.js';
import { fetchWithRetry, pollUntil } from '../util/http.js';
import type { MediaArtifact, ProviderInfo } from './types.js';

// AI video generation provider. Real path = Runway (api.dev.runwayml.com):
// create a text-to-video task, then poll tasks/{id} until SUCCEEDED. Falls back
// to a deterministic mock when no RUNWAY_API_KEY is set.
const log = createLogger({ mod: 'video' });
export type VideoModel = 'runway' | 'kling' | 'veo';

export type RunwayRatio = '1280:720' | '720:1280' | '1104:832' | '960:960';
export interface VideoRequest { prompt: string; model: VideoModel; durationS: number; takes?: number; seed?: number; ratio?: RunwayRatio; promptImage?: string }
export interface VideoProvider extends ProviderInfo { generate(req: VideoRequest): Promise<MediaArtifact[]> }

interface RunwayTask { id: string; status: 'PENDING' | 'RUNNING' | 'THROTTLED' | 'SUCCEEDED' | 'FAILED'; output?: string[]; failure?: string; failureCode?: string }

export class RunwayVideo implements VideoProvider {
  readonly name = 'runway'; readonly live = true;
  constructor(private apiKey: string) {}

  private headers() {
    const c = config();
    return { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json', 'X-Runway-Version': c.RUNWAY_VERSION };
  }

  // Shared resilience core: per-attempt timeout, transient-only retry — a 4xx
  // (bad key/param) throws immediately with the status instead of burning retries.
  private async req<T>(path: string, init: RequestInit): Promise<T> {
    const res = await fetchWithRetry(`${config().RUNWAY_API_BASE}${path}`, { ...init, headers: this.headers() }, { label: 'runway' });
    return (await res.json()) as T;
  }

  // gen4.5 is image-to-video — it needs a start image. gen4_image ratios differ from
  // the video ratios, so map to the nearest supported image ratio.
  private imageRatio(videoRatio?: RunwayRatio): string {
    switch (videoRatio) {
      case '720:1280': return '1080:1920';
      case '960:960': return '1024:1024';
      case '1104:832': return '1440:1080';
      default: return '1920:1080';
    }
  }

  // Text → start image (gen4_image), so we can drive image-to-video from a pure prompt.
  private async createImageTask(promptText: string, ratio?: RunwayRatio): Promise<string> {
    const c = config();
    const out = await this.req<{ id: string }>('/v1/text_to_image', {
      method: 'POST',
      body: JSON.stringify({ model: c.RUNWAY_IMAGE_MODEL, promptText, ratio: this.imageRatio(ratio) }),
    });
    return out.id;
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

  private async poll(id: string, kind: 'image' | 'video'): Promise<string[]> {
    return pollUntil<string[]>({
      label: `runway ${kind} task ${id}`,          // task id in the timeout error for crash forensics
      intervalMs: 5000,
      timeoutMs: config().RUNWAY_POLL_TIMEOUT_MS,
      check: async () => {
        const t = await this.req<RunwayTask>(`/v1/tasks/${id}`, { method: 'GET' });
        if (t.status === 'SUCCEEDED') return t.output ?? [];
        if (t.status === 'FAILED') throw new Error(`Runway task ${id} failed: ${t.failureCode ?? ''} ${t.failure ?? ''}`.trim());
        return undefined;
      },
    });
  }

  async generate(req: VideoRequest): Promise<MediaArtifact[]> {
    const c = config();
    const takes = Math.min(req.takes ?? 1, c.RUNWAY_MAX_TAKES); // cap real-API takes to control cost
    // Cost estimated via the cost model BEFORE returning: per take, one video run
    // plus the synthesized start image when the caller didn't supply one.
    const perTakeCost = estimateShotCost(req.durationS, 'runway') + (req.promptImage ? 0 : estimateImageCost());
    // Takes are independent tasks — submit and poll them concurrently.
    const settled = await settleLimit(Array.from({ length: takes }, (_, i) => i), takes, async (i): Promise<MediaArtifact> => {
      // gen4.5 needs a start image: synthesize one from the prompt unless caller gave one.
      let promptImage = req.promptImage;
      if (!promptImage) {
        const imgId = await this.createImageTask(req.prompt, req.ratio);
        log.info('runway image task submitted', { id: imgId, take: i });
        const imgs = await this.poll(imgId, 'image');
        if (imgs.length === 0) throw new Error(`Runway image task ${imgId} returned no output`);
        promptImage = imgs[0]!;
      }
      const id = await this.createTask({ ...req, promptImage });
      log.info('runway video task submitted', { id, take: i, duration: req.durationS });
      const urls = await this.poll(id, 'video');
      if (urls.length === 0) throw new Error(`Runway task ${id} returned no output`);
      return { uri: urls[0]!, durationS: req.durationS, costUsd: perTakeCost, meta: { take: i, taskId: id, model: c.RUNWAY_MODEL } };
    });
    for (const f of settled.failed) log.warn('take failed', { take: f.item, err: String(f.error).slice(0, 200) });
    if (settled.ok.length === 0) throw new Error(`Runway produced no usable takes: ${String(settled.failed[0]?.error).slice(0, 200)}`);
    return settled.ok.map((o) => o.value);
  }
}

class MockVideo implements VideoProvider {
  readonly name = 'mock'; readonly live = false;
  async generate(req: VideoRequest): Promise<MediaArtifact[]> {
    const takes = req.takes ?? 2;
    return Array.from({ length: takes }, (_, i) => ({ uri: `mock://video/${req.model}/${Math.abs(hash(req.prompt))}_${i}.mp4`, durationS: req.durationS, costUsd: 0, license: 'mock', meta: { take: i, model: req.model } }));
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
