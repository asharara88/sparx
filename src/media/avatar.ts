import { readFileSync } from 'node:fs';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { estimateAvatarCost } from '../skills/cost.js';
import type { MediaArtifact, ProviderInfo } from './types.js';

// Avatar video provider. Real path = HeyGen (v2 generate + v1 status poll):
//   POST /v2/video/generate  -> { data: { video_id } }
//   GET  /v1/video_status.get?video_id=...  -> { data: { status, video_url } }
// When `audioUri` is set the avatar lip-syncs to that audio (voice type 'audio'):
// a local file is first uploaded via POST {HEYGEN_UPLOAD_BASE}/v1/asset, an http(s)
// url is passed straight through. Otherwise HeyGen's own TTS speaks `text`.
// Falls back to a deterministic mock when no HEYGEN_API_KEY is set.
const log = createLogger({ mod: 'avatar' });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TRANSIENT = new Set([408, 429, 500, 502, 503, 504]);
const isHttp = (uri: string) => /^https?:\/\//i.test(uri);

export interface AvatarRequest {
  text: string;
  avatarId: string;
  voiceId: string;
  durationS: number;
  ratio?: { width: number; height: number };
  audioUri?: string;   // narration audio (local path or url); HeyGen lip-syncs to it instead of TTS-ing `text`
}
export interface AvatarProvider extends ProviderInfo { generate(req: AvatarRequest): Promise<MediaArtifact> }

// Which voice carries an avatar clip. 'elevenlabs' = synthesize the narration with the
// voice provider and let HeyGen lip-sync to the uploaded audio (your cloned voice);
// 'heygen' = HeyGen's built-in TTS. 'auto' prefers ElevenLabs when it is live.
export function resolveAvatarVoice(setting: 'auto' | 'heygen' | 'elevenlabs', voiceLive: boolean): 'heygen' | 'elevenlabs' {
  if (setting === 'heygen') return 'heygen';
  return voiceLive ? 'elevenlabs' : 'heygen';
}

interface StatusData { status: 'pending' | 'waiting' | 'processing' | 'completed' | 'failed'; video_url?: string; duration?: number; error?: unknown }

class HeyGenAvatar implements AvatarProvider {
  readonly name = 'heygen'; readonly live = true;
  constructor(private apiKey: string) {}
  private headers() { return { 'X-Api-Key': this.apiKey, 'Content-Type': 'application/json' }; }

  private async req<T>(path: string, init: RequestInit, attempts = 3): Promise<T> {
    const c = config();
    let last: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await fetch(`${c.HEYGEN_API_BASE}${path}`, { ...init, headers: this.headers() });
        if (!res.ok) {
          const body = await res.text();
          if (TRANSIENT.has(res.status) && i < attempts - 1) { await sleep(2 ** i * 700); continue; }
          throw new Error(`HeyGen ${res.status}: ${body.slice(0, 240)}`);
        }
        return (await res.json()) as T;
      } catch (e) { last = e; if (i < attempts - 1) await sleep(2 ** i * 700); }
    }
    throw new Error(`HeyGen request failed: ${String(last)}`);
  }

  // Upload local narration audio to HeyGen's asset store; returns the asset id used
  // as the lip-sync source. Same retry/backoff policy as req(), but a different host
  // (upload.heygen.com) and a raw binary body instead of json.
  private async uploadAudio(path: string, attempts = 3): Promise<string> {
    const c = config();
    const bytes = readFileSync(path);
    const contentType = /\.wav$/i.test(path) ? 'audio/x-wav' : 'audio/mpeg';
    let last: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await fetch(`${c.HEYGEN_UPLOAD_BASE}/v1/asset`, {
          method: 'POST',
          headers: { 'X-Api-Key': this.apiKey, 'Content-Type': contentType },
          body: new Uint8Array(bytes),
        });
        if (!res.ok) {
          const body = await res.text();
          if (TRANSIENT.has(res.status) && i < attempts - 1) { await sleep(2 ** i * 700); continue; }
          throw new Error(`HeyGen asset upload ${res.status}: ${body.slice(0, 240)}`);
        }
        const out = (await res.json()) as { data?: { id?: string; asset_id?: string } };
        const id = out.data?.id ?? out.data?.asset_id;
        if (!id) throw new Error(`HeyGen asset upload returned no id: ${JSON.stringify(out).slice(0, 240)}`);
        return id;
      } catch (e) { last = e; if (i < attempts - 1) await sleep(2 ** i * 700); }
    }
    throw new Error(`HeyGen asset upload failed: ${String(last)}`);
  }

  private async voicePayload(req: AvatarRequest): Promise<Record<string, unknown>> {
    if (req.audioUri) {
      if (isHttp(req.audioUri)) return { type: 'audio', audio_url: req.audioUri };
      const assetId = await this.uploadAudio(req.audioUri);
      log.info('narration audio uploaded for lip sync', { assetId });
      return { type: 'audio', audio_asset_id: assetId };
    }
    return { type: 'text', input_text: req.text, voice_id: req.voiceId };
  }

  private async create(req: AvatarRequest): Promise<string> {
    const body = {
      video_inputs: [{
        character: { type: 'avatar', avatar_id: req.avatarId, avatar_style: 'normal' },
        voice: await this.voicePayload(req),
      }],
      dimension: req.ratio ?? { width: 1280, height: 720 },
    };
    const out = await this.req<{ error: unknown; data: { video_id: string } }>('/v2/video/generate', { method: 'POST', body: JSON.stringify(body) });
    if (!out.data?.video_id) throw new Error(`HeyGen create returned no video_id: ${JSON.stringify(out.error)}`);
    return out.data.video_id;
  }

  private async poll(videoId: string): Promise<StatusData> {
    const c = config();
    const deadline = Date.now() + c.HEYGEN_POLL_TIMEOUT_MS;
    let delay = 4000;
    while (Date.now() < deadline) {
      const out = await this.req<{ data: StatusData }>(`/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`, { method: 'GET' });
      const d = out.data;
      if (d.status === 'completed') return d;
      if (d.status === 'failed') throw new Error(`HeyGen video failed: ${JSON.stringify(d.error)}`);
      await sleep(delay);
      delay = Math.min(delay * 1.5, 15000);
    }
    throw new Error(`HeyGen video ${videoId} timed out`);
  }

  async generate(req: AvatarRequest): Promise<MediaArtifact> {
    const id = await this.create(req);
    log.info('heygen video submitted', { id });
    const d = await this.poll(id);
    const duration = d.duration ?? req.durationS;
    return { uri: d.video_url ?? '', durationS: duration, costUsd: estimateAvatarCost(duration), meta: { videoId: id, provider: 'heygen' } };
  }
}

class MockAvatar implements AvatarProvider {
  readonly name = 'mock'; readonly live = false;
  async generate(req: AvatarRequest): Promise<MediaArtifact> {
    const words = req.text.split(/\s+/).filter(Boolean).length;
    const dur = Math.max(2, Math.round(words / 2.3));
    return { uri: `mock://avatar/${encodeURIComponent(req.avatarId || 'default')}/${words}w.mp4`, durationS: dur, costUsd: 0, meta: { provider: 'mock', voice: req.audioUri ? 'audio' : 'text' } };
  }
}

let provider: AvatarProvider | null = null;
export function getAvatar(): AvatarProvider {
  if (provider) return provider;
  const c = config();
  provider = c.HEYGEN_API_KEY ? new HeyGenAvatar(c.HEYGEN_API_KEY) : new MockAvatar();
  return provider;
}
export function __setAvatar(p: AvatarProvider | null) { provider = p; }
export { HeyGenAvatar };
