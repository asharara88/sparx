import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createLogger } from '../logger.js';
import { config } from '../config.js';
import { fetchWithRetry } from '../util/http.js';
import { PRICES } from '../skills/costModel.js';
import { probeMedia } from '../skills/mediaProbe.js';
import type { MediaArtifact, ProviderInfo } from './types.js';

// Music/SFX provider. When ELEVENLABS_API_KEY is set we compose a real instrumental
// bed via the ElevenLabs Music API; otherwise we fall back to a mock that only names
// a track sized to the runtime. (Mirrors the voice provider's live/mock split.)
const log = createLogger({ mod: 'music' });
export interface MusicProvider extends ProviderInfo { selectTrack(mood: string, durationS: number): Promise<MediaArtifact>; sfx(name: string): Promise<MediaArtifact> }

const hash = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 12);

// The render step loops the bed (-stream_loop -1) to fill the full runtime, so we only
// ever generate a short clip — keeps ElevenLabs cost + latency down. 3s floor / 45s cap.
const BED_FLOOR_MS = 3_000;
const BED_CAP_MS = 45_000;

class ElevenLabsMusic implements MusicProvider {
  readonly name = 'elevenlabs'; readonly live = true;
  constructor(private apiKey: string) {}

  async selectTrack(mood: string, durationS: number): Promise<MediaArtifact> {
    const ms = Math.max(BED_FLOOR_MS, Math.min(BED_CAP_MS, Math.round((durationS || 30) * 1000)));
    const prompt = `Instrumental background music bed, ${mood}, subtle and understated, no vocals, consistent energy, seamless loop`;
    // Streaming compose endpoint returns raw audio bytes (like the TTS endpoint), which
    // is what the render step needs to composite. The /music/detailed endpoint used by
    // scripts/sparx_music_gen.mjs returns richer metadata but isn't needed here.
    const url = new URL('https://api.elevenlabs.io/v1/music');
    url.searchParams.set('output_format', 'mp3_44100_128');
    const res = await fetchWithRetry(url.toString(), {
      method: 'POST',
      headers: { 'xi-api-key': this.apiKey, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify({ prompt, music_length_ms: ms, force_instrumental: true, model_id: 'music_v2' }),
    }, { label: 'elevenlabs.music' });
    const bytes = Buffer.from(await res.arrayBuffer());
    // Persist to a real local file so the render step can composite it. (Swap for object
    // storage in a hosted deployment.) The file path is the artifact uri.
    const dir = join('generated', 'music');
    mkdirSync(dir, { recursive: true });
    const file = resolve(join(dir, `bed_${hash(prompt + ms)}.mp3`));
    writeFileSync(file, bytes);
    // ElevenLabs music is credit-priced with no confirmed per-second USD rate;
    // PRICES.music_flat is the single tuning knob so ledger and estimate can't drift.
    const probe = await probeMedia(file);
    return { uri: file, durationS: probe?.durationS || Math.round(ms / 1000), costUsd: PRICES.music_flat, license: 'elevenlabs-music', meta: { bytes: bytes.length, ms, measured: Boolean(probe) } };
  }

  // No music-API SFX generation yet — an honest mock artifact so callers don't break
  // and QA's license check can tell it apart from a real, licensed asset.
  async sfx(name: string): Promise<MediaArtifact> {
    return { uri: `mock://sfx/${encodeURIComponent(name)}.wav`, costUsd: 0, license: 'mock' };
  }
}

class MockMusic implements MusicProvider {
  readonly name = 'mock'; readonly live = false;
  async selectTrack(mood: string, durationS: number): Promise<MediaArtifact> {
    return { uri: `mock://music/${encodeURIComponent(mood)}_${durationS}s.mp3`, durationS, costUsd: 0, license: 'mock' };
  }
  async sfx(name: string): Promise<MediaArtifact> { return { uri: `mock://sfx/${encodeURIComponent(name)}.wav`, costUsd: 0, license: 'mock' }; }
}

let provider: MusicProvider | null = null;
export function getMusic(): MusicProvider {
  if (provider) return provider;
  const c = config();
  provider = c.ELEVENLABS_API_KEY ? new ElevenLabsMusic(c.ELEVENLABS_API_KEY) : new MockMusic();
  if (!provider.live) log.debug('using mock music provider');
  return provider;
}
export function __setMusic(p: MusicProvider | null) { provider = p; }
