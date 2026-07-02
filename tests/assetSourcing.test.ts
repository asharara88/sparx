import { describe, it, expect, vi, afterEach } from 'vitest';
import { PexelsStock, __setStock, getStock, type StockCandidate, type StockProvider } from '../src/media/stock.js';
import { assetSourcing } from '../src/agents/assetSourcing.js';
import { newEpisodeState, type Shot, type ScriptSection } from '../src/types/episode.js';
import { ctxFor } from './helpers.js';

const realFetch = globalThis.fetch;
delete process.env.PEXELS_API_KEY; // zero-key path tests assert the mock provider (runs before the config cache is primed)
afterEach(() => { globalThis.fetch = realFetch; __setStock(null); vi.restoreAllMocks(); });

function shot(id: string, sectionId: string, source: Shot['source'], durationS = 6): Shot {
  return { shot_id: id, section_id: sectionId, source, duration_s: durationS, prompt: {}, selected_asset: null, cost_estimate_usd: 0 };
}
function section(id: string, over: Partial<ScriptSection> = {}): ScriptSection {
  return { id, beat: 'the stakes', vo_text: 'narration text', shot_note: 'aerial drone city skyline at dusk', on_screen: 'SMASH SUBSCRIBE!!!', retention_device: '', ...over };
}

function stubStock(candidatesFor: (query: string, kind: string) => StockCandidate[]): StockProvider & { queries: { query: string; kind: string; count: number }[] } {
  const p = {
    name: 'stub', live: false, queries: [] as { query: string; kind: string; count: number }[],
    async search(query: string, kind: 'video' | 'image', count: number) {
      p.queries.push({ query, kind, count });
      return candidatesFor(query, kind);
    },
  };
  return p as any;
}

describe('assetSourcing agent', () => {
  it('builds the query from shot_note + beat, never on-screen caption text', async () => {
    const stock = stubStock(() => [{ uri: 'mock://stock/video/x.mp4', width: 1920, height: 1080, durationS: 8, description: 'city', license: 'mock' }]);
    __setStock(stock);
    const s = newEpisodeState('ep_as1');
    s.concept.topic = 'urban planning';
    s.script.sections = [section('s1')];
    s.shot_list = [shot('sh1', 's1', 'stock')];
    const r = await assetSourcing.run(ctxFor(s));
    expect(r.status).toBe('ok');
    const q = stock.queries[0]!;
    expect(q.query).toMatch(/city|skyline|drone|aerial/);
    expect(q.query).not.toMatch(/subscribe|smash/i);
    expect(q.count).toBeGreaterThanOrEqual(5); // multiple candidates so ranking has signal
  });

  it('selects the best-ranked candidate, not candidates[0], and carries the provider license', async () => {
    const stock = stubStock((query) => [
      { uri: 'https://cdn/junk-portrait.mp4', width: 720, height: 1280, durationS: 30, description: 'unrelated dance', license: 'pexels' },
      { uri: 'https://cdn/tiny.mp4', width: 426, height: 240, durationS: 2, description: 'blurry', license: 'pexels' },
      { uri: 'https://cdn/best.mp4', width: 1920, height: 1080, durationS: 9, description: query, license: 'pexels' },
    ]);
    __setStock(stock);
    const s = newEpisodeState('ep_as2');
    s.script.sections = [section('s1')];
    s.shot_list = [shot('sh1', 's1', 'stock', 6)];
    const r = await assetSourcing.run(ctxFor(s));
    expect(r.writes.sourced_assets).toHaveLength(1);
    expect(r.writes.sourced_assets![0]!.uri).toBe('https://cdn/best.mp4');
    expect(r.writes.sourced_assets![0]!.license).toBe('pexels');
    expect(r.writes.sourced_assets![0]!.cost_usd).toBe(0);
  });

  it('requests images for graphic shots and degrades failures/empties to skips', async () => {
    const stock = stubStock((query, kind) => {
      if (query.includes('boom')) throw new Error('pexels 500');
      if (kind === 'image') return [{ uri: 'mock://stock/image/g.jpg', width: 1920, height: 1080, description: query, license: 'mock' }];
      return [];
    });
    __setStock(stock);
    const s = newEpisodeState('ep_as3');
    s.script.sections = [
      section('s1', { shot_note: 'chart of housing prices' }),
      section('s2', { shot_note: 'boom failure lookup' }),
      section('s3', { shot_note: 'obscure nothing matches' }),
    ];
    s.shot_list = [shot('sh1', 's1', 'graphic'), shot('sh2', 's2', 'stock'), shot('sh3', 's3', 'stock')];
    const r = await assetSourcing.run(ctxFor(s));
    expect(r.status).toBe('ok'); // one throw + one empty result must not sink the batch
    expect(stock.queries.find((q) => q.query.includes('chart'))?.kind).toBe('image');
    expect(r.writes.sourced_assets).toHaveLength(1);
    expect(r.writes.sourced_assets![0]).toMatchObject({ shot_id: 'sh1', type: 'image' });
    expect(r.notes).toMatch(/2 misses/);
  });
});

describe('MockStock (zero-key path)', () => {
  it('returns the requested number of deterministic candidates with license mock', async () => {
    __setStock(null);
    const mock = getStock();
    expect(mock.live).toBe(false);
    const a = await mock.search('city skyline', 'video', 6);
    const b = await mock.search('city skyline', 'video', 6);
    expect(a).toHaveLength(6);
    expect(a).toEqual(b); // deterministic
    for (const c of a) {
      expect(c.uri).toMatch(/^mock:\/\/stock\/video\//);
      expect(c.license).toBe('mock');
      expect(c.width).toBeGreaterThan(0);
      expect(c.durationS).toBeGreaterThan(0);
    }
    __setStock(null);
  });
});

describe('PexelsStock', () => {
  it('returns per_page=count candidates with metadata and a downloadable rendition, never the HTML page', async () => {
    const video = (id: number) => ({
      id, url: `https://www.pexels.com/video/aerial-city-skyline-${id}/`, duration: 12, width: 3840, height: 2160,
      video_files: [
        { link: `https://videos.pexels.com/${id}-uhd.mp4`, width: 3840, height: 2160, quality: 'uhd' },
        { link: `https://videos.pexels.com/${id}-hd.mp4`, width: 1920, height: 1080, quality: 'hd' },
        { link: `https://videos.pexels.com/${id}-sd.mp4`, width: 640, height: 360, quality: 'sd' },
      ],
    });
    globalThis.fetch = vi.fn(async (url: any) => ({ ok: true, status: 200, json: async () => ({ videos: [video(1), video(2)] }), text: async () => '' } as any)) as any;
    const px = new PexelsStock('key');
    const out = await px.search('city skyline', 'video', 5);
    expect(String((globalThis.fetch as any).mock.calls[0]![0])).toContain('per_page=5');
    expect(out).toHaveLength(2);
    expect(out[0]!.uri).toBe('https://videos.pexels.com/1-hd.mp4'); // HD rendition preferred over 4k, never v.url
    expect(out[0]!.description).toContain('aerial city skyline');
    expect(out[0]!.durationS).toBe(12);
    expect(out[0]!.license).toBe('pexels');
  });
});
