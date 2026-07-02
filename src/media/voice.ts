import { existsSync, mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import type { MediaArtifact, ProviderInfo } from './types.js';

// Text-to-speech provider. Real = ElevenLabs; mock otherwise.
// Cost approximated per character (ElevenLabs bills by characters/credits).
// Output is content-addressed (voice id + text hash), so identical requests hit the
// on-disk cache instead of re-billing the API — the voiceover and avatar agents
// synthesize the same section text concurrently, and an in-flight map dedupes those.
const log = createLogger({ mod: 'voice' });
const COST_PER_1K_CHARS = 0.0003 * 1000 / 1000; // ~ creator-tier; tune as needed

const hash = (s: string) => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h).toString(36); };
const inflight = new Map<string, Promise<MediaArtifact>>();

export interface VoiceProvider extends ProviderInfo {
  synthesize(text: string, voiceId: string): Promise<MediaArtifact>;
}

class ElevenLabsVoice implements VoiceProvider {
  readonly name = 'elevenlabs'; readonly live = true;
  constructor(private apiKey: string) {}

  async synthesize(text: string, voiceId: string): Promise<MediaArtifact> {
    const id = voiceId.replace(/^elevenlabs:/, '');
    // Text length in the key makes 32-bit hash collisions across texts effectively impossible.
    const key = `${id}_${hash(text)}_${text.length}`;
    const dir = join('generated', 'voice');
    const file = resolve(join(dir, `${key}.mp3`));
    const durationS = Math.round(text.split(/\s+/).length / 2.3);

    if (existsSync(file) && statSync(file).size > 0) {
      return { uri: file, durationS, costUsd: 0, meta: { bytes: statSync(file).size, cached: true } };
    }
    // Joiners of an in-flight synthesis report zero cost — only the initiating
    // caller records the API charge, else concurrent voiceover+avatar requests
    // for the same section would double-count one ElevenLabs bill in the ledger.
    const pending = inflight.get(key);
    if (pending) return pending.then((a) => ({ ...a, costUsd: 0, meta: { ...a.meta, cached: true } }));

    const work = (async (): Promise<MediaArtifact> => {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${id}`, {
        method: 'POST',
        headers: { 'xi-api-key': this.apiKey, 'content-type': 'application/json', accept: 'audio/mpeg' },
        body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' }),
      });
      if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      // Persist to a real local file so the render step can composite it. (Swap for
      // object storage in a hosted deployment.) The file path is the artifact uri.
      // Write via temp + rename so a killed process never leaves a truncated mp3
      // that would later pass the cache check.
      mkdirSync(dir, { recursive: true });
      const tmp = `${file}.tmp-${process.pid}`;
      writeFileSync(tmp, bytes);
      renameSync(tmp, file);
      const costUsd = Math.round((text.length / 1000) * COST_PER_1K_CHARS * 1e4) / 1e4;
      return { uri: file, durationS, costUsd, meta: { bytes: bytes.length } };
    })();
    inflight.set(key, work);
    try { return await work; } finally { inflight.delete(key); }
  }
}

class MockVoice implements VoiceProvider {
  readonly name = 'mock'; readonly live = false;
  async synthesize(text: string, voiceId: string): Promise<MediaArtifact> {
    const words = text.split(/\s+/).filter(Boolean).length;
    return { uri: `mock://voice/${encodeURIComponent(voiceId)}/${words}w.mp3`, durationS: Math.max(1, Math.round(words / 2.3)), costUsd: 0 };
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
