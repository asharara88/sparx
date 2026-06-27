import { createLogger } from '../logger.js';
import type { MediaArtifact, ProviderInfo } from './types.js';

// Music/SFX provider. Epidemic Sound has no simple public generation API, so this
// is a mock that selects a track sized to the runtime; swap for a real library/API later.
const log = createLogger({ mod: 'music' });
export interface MusicProvider extends ProviderInfo { selectTrack(mood: string, durationS: number): Promise<MediaArtifact>; sfx(name: string): Promise<MediaArtifact> }

class MockMusic implements MusicProvider {
  readonly name = 'mock'; readonly live = false;
  async selectTrack(mood: string, durationS: number): Promise<MediaArtifact> {
    return { uri: `mock://music/${encodeURIComponent(mood)}_${durationS}s.mp3`, durationS, costUsd: 0, license: 'mock-music-license' };
  }
  async sfx(name: string): Promise<MediaArtifact> { return { uri: `mock://sfx/${encodeURIComponent(name)}.wav`, costUsd: 0, license: 'mock-sfx-license' }; }
}

let provider: MusicProvider | null = null;
export function getMusic(): MusicProvider { if (!provider) { provider = new MockMusic(); log.debug('using mock music provider'); } return provider; }
export function __setMusic(p: MusicProvider | null) { provider = p; }
