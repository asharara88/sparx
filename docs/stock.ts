import { config } from '../config.js';
import { createLogger } from '../logger.js';
import type { MediaArtifact, ProviderInfo } from './types.js';

// Stock b-roll / image provider. Real = Pexels (free API); mock otherwise.
const log = createLogger({ mod: 'stock' });
export interface StockProvider extends ProviderInfo { find(query: string, kind: 'video' | 'image'): Promise<MediaArtifact | null> }

class PexelsStock implements StockProvider {
  readonly name = 'pexels'; readonly live = true;
  constructor(private apiKey: string) {}
  async find(query: string, kind: 'video' | 'image'): Promise<MediaArtifact | null> {
    const base = kind === 'video' ? 'https://api.pexels.com/videos/search' : 'https://api.pexels.com/v1/search';
    const res = await fetch(`${base}?per_page=1&query=${encodeURIComponent(query)}`, { headers: { Authorization: this.apiKey } });
    if (!res.ok) { log.warn('pexels error', { status: res.status }); return null; }
    const data = (await res.json()) as any;
    if (kind === 'video') {
      const v = data.videos?.[0]; if (!v) return null;
      return { uri: v.video_files?.[0]?.link ?? v.url, durationS: v.duration, costUsd: 0, license: 'Pexels License', meta: { id: v.id } };
    }
    const p = data.photos?.[0]; if (!p) return null;
    return { uri: p.src?.large ?? p.url, costUsd: 0, license: 'Pexels License', meta: { id: p.id } };
  }
}

class MockStock implements StockProvider {
  readonly name = 'mock'; readonly live = false;
  async find(query: string, kind: 'video' | 'image'): Promise<MediaArtifact | null> {
    return { uri: `mock://stock/${kind}/${encodeURIComponent(query).slice(0, 24)}.${kind === 'video' ? 'mp4' : 'jpg'}`, durationS: kind === 'video' ? 6 : undefined, costUsd: 0, license: 'mock-stock-license' };
  }
}

let provider: StockProvider | null = null;
export function getStock(): StockProvider {
  if (provider) return provider;
  const c = config();
  provider = c.PEXELS_API_KEY ? new PexelsStock(c.PEXELS_API_KEY) : new MockStock();
  return provider;
}
export function __setStock(p: StockProvider | null) { provider = p; }
