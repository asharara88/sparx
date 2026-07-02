import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { fetchWithRetry } from '../util/http.js';
import type { AssetCandidate } from '../skills/assetMatching.js';
import type { ProviderInfo } from './types.js';

// Stock b-roll / image provider. Real = Pexels (free API); mock otherwise.
// Returns MULTIPLE candidates with ranking metadata (dimensions, duration,
// description) — selection belongs to the asset-matching skill, not the provider.
const log = createLogger({ mod: 'stock' });

export interface StockCandidate extends AssetCandidate { license: string }
export interface StockProvider extends ProviderInfo { search(query: string, kind: 'video' | 'image', count: number): Promise<StockCandidate[]> }

interface PexelsVideoFile { link?: string; width?: number; height?: number; quality?: string }

// Pick a real downloadable rendition (video_files link), never the pexels.com HTML
// page URL. Prefer HD (720–1440p) over 4k to balance quality vs download size.
function bestVideoFile(files: PexelsVideoFile[] | undefined): PexelsVideoFile | null {
  const withLink = (files ?? []).filter((f) => !!f.link);
  if (withLink.length === 0) return null;
  const byWidth = [...withLink].sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  return byWidth.find((f) => (f.height ?? 0) >= 720 && (f.height ?? 0) <= 1440) ?? byWidth[0]!;
}

// Pexels videos carry no alt text; the page URL slug is descriptive
// ('…/video/aerial-view-of-a-city-1234/') — recover ranking keywords from it.
function slugWords(pageUrl?: string): string {
  const m = /\/(?:video|photo)\/([a-z0-9-]+?)-?\d*\/?$/.exec(pageUrl ?? '');
  return m?.[1]?.replace(/-/g, ' ') ?? '';
}

export class PexelsStock implements StockProvider {
  readonly name = 'pexels'; readonly live = true;
  constructor(private apiKey: string) {}
  async search(query: string, kind: 'video' | 'image', count: number): Promise<StockCandidate[]> {
    const base = kind === 'video' ? 'https://api.pexels.com/videos/search' : 'https://api.pexels.com/v1/search';
    const res = await fetchWithRetry(`${base}?per_page=${count}&query=${encodeURIComponent(query)}`, { headers: { Authorization: this.apiKey } }, { label: 'pexels' });
    const data = (await res.json()) as any;
    if (kind === 'video') {
      return ((data.videos ?? []) as any[]).flatMap((v): StockCandidate[] => {
        const f = bestVideoFile(v.video_files);
        if (!f) { log.warn('pexels video without downloadable rendition', { id: v.id }); return []; }
        return [{ uri: f.link!, width: f.width ?? v.width, height: f.height ?? v.height, durationS: v.duration, description: slugWords(v.url), license: 'pexels' }];
      });
    }
    return ((data.photos ?? []) as any[]).flatMap((p): StockCandidate[] => {
      const uri = p.src?.large2x ?? p.src?.large ?? p.src?.original;
      if (!uri) return [];
      return [{ uri, width: p.width, height: p.height, description: p.alt || slugWords(p.url), license: 'pexels' }];
    });
  }
}

class MockStock implements StockProvider {
  readonly name = 'mock'; readonly live = false;
  async search(query: string, kind: 'video' | 'image', count: number): Promise<StockCandidate[]> {
    const slug = encodeURIComponent(query).slice(0, 24);
    // Deterministic descending quality so rankAssets has real (stable) signal.
    return Array.from({ length: count }, (_, i) => ({
      uri: `mock://stock/${kind}/${slug}_${i}.${kind === 'video' ? 'mp4' : 'jpg'}`,
      width: 1920 - i * 160,
      height: 1080 - i * 90,
      durationS: kind === 'video' ? 6 + i * 3 : undefined,
      description: query,
      license: 'mock',
    }));
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
