// SEO keyword skill: clusters keywords into topical groups by shared head term.
// Heuristic and deterministic — no paid provider wired. Used by the research agent
// (cluster labels and primary phrases feed the concept keywords).
export interface KeywordCluster { label: string; keywords: string[] }
export interface SeoResult { seed: string; clusters: KeywordCluster[]; primary: string[] }

// Function words that would make meaningless cluster labels ('best ai tools' and
// 'top ai tools' must cluster on the substance, never on 'best'/'top').
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'best', 'for', 'from', 'how', 'in', 'is', 'my', 'of', 'on', 'or',
  'that', 'the', 'their', 'this', 'to', 'top', 'vs', 'what', 'when', 'why', 'with', 'without', 'your',
]);

// Lightweight heuristic clustering by shared head term. Good enough as a real,
// deterministic baseline; swap in an embeddings/volume provider later.
export function clusterKeywords(seed: string, keywords: string[]): SeoResult {
  const norm = Array.from(new Set(keywords.map((k) => k.trim().toLowerCase()).filter(Boolean)));
  const buckets = new Map<string, string[]>();
  for (const k of norm) {
    const tokens = k.split(/\s+/);
    // Head = first substantive token; a stopword can never become a cluster label.
    // All-stopword phrases fall back to the whole phrase as their own bucket.
    const key = tokens.find((t) => !STOPWORDS.has(t) && t.length > 3)
      ?? tokens.find((t) => !STOPWORDS.has(t))
      ?? k;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(k);
  }
  const clusters: KeywordCluster[] = [...buckets.entries()].map(([label, kws]) => ({ label, keywords: kws }));
  // primary = the seed plus the longest (most specific) couple of phrases
  const primary = [seed.toLowerCase(), ...norm.sort((a, b) => b.length - a.length).slice(0, 3)];
  return { seed, clusters, primary: Array.from(new Set(primary)) };
}

import { defineSkill } from '../registry.js';
export const seoKeywordSkill = defineSkill<{ seed: string; keywords: string[] }, SeoResult>({
  name: 'seo-keywords',
  description: 'Cluster keywords into topical groups and pick primary phrases for titles/tags (heuristic baseline; provider-upgradeable).',
  run: async ({ seed, keywords }) => clusterKeywords(seed, keywords),
});
