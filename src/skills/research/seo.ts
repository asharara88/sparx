// SEO keyword skill: clusters keywords into topical groups and (optionally) attaches
// search-volume via a provider. No paid key wired by default — volumes are null and
// the clustering is heuristic. Used by Research (1), Packaging (10), Publishing (11).
export interface KeywordCluster { label: string; keywords: string[] }
export interface SeoResult { seed: string; clusters: KeywordCluster[]; primary: string[] }

// Lightweight heuristic clustering by shared head term. Good enough as a real,
// deterministic baseline; swap in an embeddings/volume provider later.
export function clusterKeywords(seed: string, keywords: string[]): SeoResult {
  const norm = Array.from(new Set(keywords.map((k) => k.trim().toLowerCase()).filter(Boolean)));
  const buckets = new Map<string, string[]>();
  for (const k of norm) {
    const head = (k.split(/\s+/)[0] ?? 'misc');
    const key = head.length > 3 ? head : (k.split(/\s+/)[1] ?? head);
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
