import { config } from '../../config.js';
import { createLogger } from '../../logger.js';

// Web research skill with a pluggable provider. Real provider = Tavily (TAVILY_API_KEY);
// falls back to a deterministic mock so research runs offline. Used by Research (1) & QA (12).
export interface SearchResult { title: string; url: string; snippet: string }
export interface WebSearchProvider { readonly name: string; search(query: string, max?: number): Promise<SearchResult[]> }

const log = createLogger({ mod: 'webSearch' });

class TavilyProvider implements WebSearchProvider {
  readonly name = 'tavily';
  constructor(private apiKey: string) {}
  async search(query: string, max = 6): Promise<SearchResult[]> {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ api_key: this.apiKey, query, max_results: max, search_depth: 'basic' }),
    });
    if (!res.ok) { log.warn('tavily error, returning empty', { status: res.status }); return []; }
    const data = (await res.json()) as { results?: { title: string; url: string; content: string }[] };
    return (data.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content?.slice(0, 280) ?? '' }));
  }
}

class MockProvider implements WebSearchProvider {
  readonly name = 'mock';
  async search(query: string, max = 6): Promise<SearchResult[]> {
    return Array.from({ length: Math.min(max, 3) }, (_, i) => ({
      title: `${query} — result ${i + 1}`,
      url: `https://example.com/${encodeURIComponent(query)}/${i + 1}`,
      snippet: `(mock) representative snippet about "${query}".`,
    }));
  }
}

let provider: WebSearchProvider | null = null;
export function getWebSearch(): WebSearchProvider {
  if (provider) return provider;
  const c = config();
  provider = c.TAVILY_API_KEY ? new TavilyProvider(c.TAVILY_API_KEY) : new MockProvider();
  return provider;
}
export function __setWebSearch(p: WebSearchProvider | null) { provider = p; }

export async function webResearch(query: string, max = 6): Promise<{ query: string; results: SearchResult[]; live: boolean }> {
  const p = getWebSearch();
  const results = await p.search(query, max);
  return { query, results, live: p.name !== 'mock' };
}

import { defineSkill } from '../registry.js';
export const webResearchSkill = defineSkill<{ query: string; max?: number }, { query: string; results: SearchResult[]; live: boolean }>({
  name: 'web-research',
  description: 'Search the web via the configured provider (Tavily when keyed, deterministic mock otherwise); returns titled results with snippets.',
  live: () => getWebSearch().name !== 'mock',
  run: ({ query, max }) => webResearch(query, max),
});
