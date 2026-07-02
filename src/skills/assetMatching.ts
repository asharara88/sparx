import { defineSkill } from './registry.js';

// Real asset matching (replaces the hardcoded 0.5-score stub). Owns two jobs the
// asset-sourcing agent used to improvise: building a good stock-search query from
// shot context, and ranking returned candidates by fit (keyword overlap,
// orientation, resolution, duration) instead of taking candidate[0] blind.

export interface AssetCandidate {
  uri: string;
  width?: number;
  height?: number;
  durationS?: number;
  description?: string;   // provider alt text / tags
}

export interface RankedAsset extends AssetCandidate { score: number }

const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'to', 'and', 'in', 'on', 'for', 'with', 'is', 'are', 'this', 'that', 'it', 'as', 'at', 'by']);

export function keywords(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/** Build a focused stock-search query from shot + section context (not raw caption text). */
export function buildAssetQuery(input: { shot_note: string; beat?: string; topic?: string }): string {
  const kw = [...new Set([...keywords(input.shot_note), ...keywords(input.beat ?? '')])].slice(0, 5);
  if (kw.length === 0) return keywords(input.topic ?? 'abstract background').slice(0, 3).join(' ') || 'abstract background';
  return kw.join(' ');
}

/**
 * Score candidates for a shot. Weights: keyword overlap with the shot description
 * (0-0.4), landscape orientation ≥720p (0-0.3), duration covering the shot (0-0.3).
 */
export function rankAssets(input: { query: string; targetDurationS?: number; candidates: AssetCandidate[] }): RankedAsset[] {
  const qWords = new Set(keywords(input.query));
  const scored = input.candidates.map((c) => {
    let score = 0;
    if (qWords.size && c.description) {
      const dWords = new Set(keywords(c.description));
      const overlap = [...qWords].filter((w) => dWords.has(w)).length;
      score += 0.4 * (overlap / qWords.size);
    } else {
      score += 0.2; // no description → neutral prior
    }
    if (c.width && c.height) {
      const landscape = c.width >= c.height;
      const hd = c.height >= 720;
      score += landscape && hd ? 0.3 : landscape ? 0.2 : 0.05;
    } else {
      score += 0.15;
    }
    if (input.targetDurationS && c.durationS) {
      score += c.durationS >= input.targetDurationS ? 0.3 : 0.3 * (c.durationS / input.targetDurationS);
    } else {
      score += 0.15;
    }
    return { ...c, score: Math.round(score * 100) / 100 };
  });
  return scored.sort((a, b) => b.score - a.score);
}

export const assetMatchingSkill = defineSkill<{ query: string; targetDurationS?: number; candidates: AssetCandidate[] }, RankedAsset[]>({
  name: 'asset-matching',
  description: 'Build stock-search queries from shot context and rank provider candidates by keyword overlap, orientation/resolution, and duration fit.',
  run: async (input) => rankAssets(input),
});
