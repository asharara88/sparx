import { existsSync, mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { fetchWithRetry } from '../util/http.js';
import { estimateVoiceCost } from '../skills/costModel.js';
import { probeMedia } from '../skills/mediaProbe.js';
import type { MediaArtifact, ProviderInfo } from './types.js';

// Text-to-speech provider. Real = ElevenLabs; mock otherwise.
// Cost comes from the consolidated cost model (skills/costModel.ts); the
// provider-reported billed-character header wins over text.length when present.
// Output is content-addressed (voice id + text hash), so identical requests hit the
// on-disk cache instead of re-billing the API — the voiceover and avatar agents
// synthesize the same section text concurrently, and an in-flight map dedupes those.
const log = createLogger({ mod: 'voice' });

const hash = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 12);
const inflight = new Map<string, Promise<MediaArtifact>>();

/** words/2.3 speaking-rate guess — the fallback when the real file can't be probed. */
export const guessSpeechSeconds = (text: string) => Math.max(1, Math.round(text.split(/\s+/).filter(Boolean).length / 2.3));

export interface VoiceProvider extends ProviderInfo {
  synthesize(text: string, voiceId: string): Promise<MediaArtifact>;
}

class ElevenLabsVoice implements VoiceProvider {
  readonly name = 'elevenlabs'; readonly live = true;
  constructor(private apiKey: string) {}

  async synthesize(text: string, voiceId: string): Promise<MediaArtifact> {
    const id = voiceId.replace(/^elevenlabs:/, '');
    const key = `${id}_${hash(text)}`;
    const dir = join('generated', 'voice');
    const file = resolve(join(dir, `${key}.mp3`));

    if (existsSync(file) && statSync(file).size > 0) {
      const probe = await probeMedia(file);
      return { uri: file, durationS: probe?.durationS || guessSpeechSeconds(text), costUsd: 0, meta: { bytes: statSync(file).size, measured: Boolean(probe), cached: true } };
    }
    // Joiners of an in-flight synthesis report zero cost — only the initiating
    // caller records the API charge, else concurrent voiceover+avatar requests
    // for the same section would double-count one ElevenLabs bill in the ledger.
    const pending = inflight.get(key);
    if (pending) return pending.then((a) => ({ ...a, costUsd: 0, meta: { ...a.meta, cached: true } }));

    const work = (async (): Promise<MediaArtifact> => {
      const res = await fetchWithRetry(`https://api.elevenlabs.io/v1/text-to-speech/${id}`, {
        method: 'POST',
        headers: { 'xi-api-key': this.apiKey, 'content-type': 'application/json', accept: 'audio/mpeg' },
        body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' }),
      }, { label: 'elevenlabs.tts' });
      const bytes = Buffer.from(await res.arrayBuffer());
      // Persist to a real local file so the render step can composite it. (Swap for
      // object storage in a hosted deployment.) The file path is the artifact uri.
      // Write via temp + rename so a killed process never leaves a truncated mp3
      // that would later pass the cache check.
      mkdirSync(dir, { recursive: true });
      const tmp = `${file}.tmp-${process.pid}`;
      writeFileSync(tmp, bytes);
      renameSync(tmp, file);
      // ElevenLabs reports billed characters in the character-cost response header;
      // fall back to text.length. Either way, price via the shared cost model.
      const billedChars = Number(res.headers?.get('character-cost'));
      const costUsd = estimateVoiceCost(Number.isFinite(billedChars) && billedChars > 0 ? billedChars : text.length);
      // Measure the mp3 we just wrote — total_duration_s sizes the music bed and the
      // caption timing downstream; the words/2.3 guess only when ffprobe is absent.
      const probe = await probeMedia(file);
      return { uri: file, durationS: probe?.durationS || guessSpeechSeconds(text), costUsd, meta: { bytes: bytes.length, measured: Boolean(probe) } };
    })();
    inflight.set(key, work);
    try { return await work; } finally { inflight.delete(key); }
  }
}

class MockVoice implements VoiceProvider {
  readonly name = 'mock'; readonly live = false;
  async synthesize(text: string, voiceId: string): Promise<MediaArtifact> {
    const words = text.split(/\s+/).filter(Boolean).length;
    return { uri: `mock://voice/${encodeURIComponent(voiceId)}/${words}w.mp3`, durationS: guessSpeechSeconds(text), costUsd: 0, license: 'mock' };
  }
}

let provider: VoiceProvider | null = null;
export function getVoice(): VoiceProvider {
  if (provider) return provider;
  const c = config();
  provider = c.ELEVENLABS_API_KEY ? new ElevenLabsVoice(c.ELEVENLABS_API_KEY) : new MockVoice();
  if (!provider.live) log.debug('using mock voice provider');
  return provider;
}
export function __setVoice(p: VoiceProvider | null) { provider = p; }
export { ElevenLabsVoice };
