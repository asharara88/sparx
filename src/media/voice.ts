import { config } from '../config.js';
import { createLogger } from '../logger.js';
import type { MediaArtifact, ProviderInfo } from './types.js';

// Text-to-speech provider. Real = ElevenLabs; mock otherwise.
// Cost approximated per character (ElevenLabs bills by characters/credits).
const log = createLogger({ mod: 'voice' });
const COST_PER_1K_CHARS = 0.0003 * 1000 / 1000; // ~ creator-tier; tune as needed

export interface VoiceProvider extends ProviderInfo {
  synthesize(text: string, voiceId: string): Promise<MediaArtifact>;
}

class ElevenLabsVoice implements VoiceProvider {
  readonly name = 'elevenlabs'; readonly live = true;
  constructor(private apiKey: string) {}
  async synthesize(text: string, voiceId: string): Promise<MediaArtifact> {
    const id = voiceId.replace(/^elevenlabs:/, '');
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${id}`, {
      method: 'POST',
      headers: { 'xi-api-key': this.apiKey, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' }),
    });
    if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    // In a full build we'd persist to object storage; here we report size + est cost.
    const costUsd = Math.round((text.length / 1000) * COST_PER_1K_CHARS * 1e4) / 1e4;
    return { uri: `mem://voice/${id}/${bytes.length}.mp3`, durationS: Math.round(text.split(/\s+/).length / 2.3), costUsd, meta: { bytes: bytes.length } };
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
