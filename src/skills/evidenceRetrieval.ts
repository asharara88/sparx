import type { ClaimVerdict, FactCheckClaim } from '../types/episode.js';
import { getLLM } from '../llm/client.js';
import { webResearch } from './research/webSearch.js';
import { defineSkill } from './registry.js';
import { z } from 'zod';

// Evidence-backed claim verification. The old QA "fact check" was an LLM opinion
// with zero evidence in context; this skill retrieves sources for each claim and
// asks a fast model to judge the claim AGAINST that evidence, returning typed
// claim/verdict/source records. Without a search provider it degrades to
// 'uncertain' (never a confident pass) — fail-closed by design.

const VerdictSchema = z.object({
  verdict: z.enum(['supported', 'unsupported', 'uncertain']),
  note: z.string(),
  source_index: z.coerce.number().int().min(1).optional(),   // 1-based evidence item the note cites
});

// Claims arrive as narration ("Studies show that X grew 40% in 2024") — search
// engines do better on the bare proposition, so strip hedging lead-ins and
// trailing punctuation before querying. Deterministic; no LLM spend.
const LEAD_INS = /^(?:studies (?:show|suggest) that|research (?:shows|suggests) that|it is (?:said|believed|known) that|experts (?:say|believe|agree) that|according to [^,]+,|did you know that|some (?:say|believe) that|in fact,?|reportedly,?)\s+/i;

export function toSearchQuery(claim: string): string {
  const q = claim.trim().replace(LEAD_INS, '').replace(/[.?!]+$/, '').trim();
  return (q || claim).slice(0, 140);
}

export async function verifyClaim(claim: string): Promise<FactCheckClaim> {
  const search = await webResearch(toSearchQuery(claim), 4).catch(() => ({ query: claim, results: [], live: false }));
  // Mock search results are fabricated snippets — judging against them would launder
  // fake evidence into a confident verdict. Fail closed to 'uncertain'.
  if (!search.live || !search.results.length) {
    return { claim, verdict: 'uncertain', source: '', note: 'no live evidence retrieved (search unavailable or mock)' };
  }
  const results = search.results;
  const evidence = results.map((r, i) => `[${i + 1}] ${r.title} (${r.url})\n${r.snippet}`).join('\n\n').slice(0, 3000);
  const llm = getLLM();
  const res = await llm.complete({
    tier: 'fast', temperature: 0, schema: VerdictSchema,
    system: 'You are a fact-checker. Judge the claim ONLY against the provided evidence. If the evidence neither supports nor refutes it, say uncertain.',
    prompt: `Claim: ${claim}\n\nEvidence:\n${evidence}\n\nReturn JSON {"verdict":"supported"|"unsupported"|"uncertain","note":"one sentence citing the evidence number","source_index":<number of the decisive evidence item>}.`,
    mock: JSON.stringify({ verdict: 'uncertain', note: 'mock verdict — no live LLM' }),
  });
  const v = res.data!;
  const source = results[(v.source_index ?? 1) - 1]?.url ?? results[0]!.url;   // record the cited source, not just the top hit
  return { claim, verdict: v.verdict as ClaimVerdict, source, note: v.note };
}

export const evidenceRetrievalSkill = defineSkill<{ claim: string }, FactCheckClaim>({
  name: 'evidence-retrieval',
  description: 'Verify a factual claim against retrieved web evidence; returns a typed claim/verdict/source record, degrading to uncertain without a provider.',
  run: async ({ claim }) => verifyClaim(claim),
});
