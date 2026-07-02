import { config } from '../../config.js';
import { createLogger } from '../../logger.js';
import { fetchWithRetry } from '../../util/http.js';

// Web research skill with a pluggable provider. Real provider = Tavily (TAVILY_API_KEY);
// falls back to a deterministic mock so research runs offline. Consumed by the research
// agent and the evidence-retrieval skill — search is enrichment for both, so the live
// provider degrades to empty results on any failure instead of throwing or hanging.
export interface SearchResult { title: string; url: string; snippet: string }
export interface WebSearchProvider { readonly name: string; search(query: string, max?: number): Promise<SearchResult[]> }

const log = createLogger({ mod: 'webSearch' });

class TavilyProvider implements WebSearchProvider {
  readonly name = 'tavily';
  constructor(private apiKey: string) {}
  async search(query: string, max = 6): Promise<SearchResult[]> {
    try {
      // fetchWithRetry: per-attempt timeout + transient-only retry; key in the
      // Authorization header, not the JSON body, so it can't leak into request logs.
      const res = await fetchWithRetry('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ query, max_results: max, search_depth: 'basic' }),
      }, { label: 'tavily' });
      const data = (await res.json()) as { results?: { title?: string; url?: string; content?: string }[] };
      return (data.results ?? [])
        .filter((r) => r.title && r.url)
        .map((r) => ({ title: r.title!, url: r.url!, snippet: r.content?.slice(0, 280) ?? '' }));
    } catch (err) {
      log.warn('tavily search failed, returning empty', { err: String(err).slice(0, 160) });
      return [];
    }
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
