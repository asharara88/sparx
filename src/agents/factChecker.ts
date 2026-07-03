import { z } from 'zod';
import { defineAgent } from './core.js';
import type { FactCheckClaim } from '../types/episode.js';
import { getLLM } from '../llm/client.js';
import { verifyClaim } from '../skills/evidenceRetrieval.js';
import { mapLimit } from '../util/concurrency.js';
import { config } from '../config.js';

// Agent — Fact Checker. Runs right after the scriptwriter (parallel with the
// visual director) so factual problems surface at GATE B, BEFORE generation
// money is spent. Extracts discrete checkable claims from the narration, then
// verifies each against retrieved web evidence via the evidence-retrieval skill.
// Writes structured claim/verdict/source records; the QA agent blocks on
// unsupported claims at Gate C.

const ClaimsSchema = z.object({
  claims: z.array(z.string().min(8)).max(8),
});

// Verification burns search + LLM spend per claim; below this floor we record
// 'uncertain' (non-blocking at Gate C) instead of spending the last cents.
const MIN_VERIFY_BUDGET_USD = 0.5;

// Near-identical key: models often restate the same stat with different casing
// or punctuation — verifying both is paying twice for one answer.
const claimKey = (c: string) => c.toLowerCase().replace(/[^a-z0-9%$ ]+/g, ' ').replace(/\s+/g, ' ').trim();

export const factChecker = defineAgent({
  name: 'fact_checker',
  description: 'Extract checkable factual claims from the script and verify each against retrieved web evidence.',
  skills: ['evidence-retrieval'],
  reads: ['script'],
  writes: ['fact_check'],
  requires: (s) => (s.script.sections.length === 0 ? 'no script to fact-check' : null),

  async execute(ctx) {
    const llm = getLLM();
    const narration = [ctx.state.script.hook, ...ctx.state.script.sections.map((s) => s.vo_text)].join('\n');

    const extraction = await llm.complete({
      tier: 'fast', temperature: 0, schema: ClaimsSchema,
      system: 'You extract discrete, externally checkable factual claims (statistics, dates, named facts, causal assertions about the world). Skip opinions, predictions, and the creator\'s own experiences.',
      prompt: `Narration:\n${narration.slice(0, 6000)}\n\nReturn JSON {"claims":[up to 8 short claim strings]}. If there are no checkable claims, return {"claims":[]}.`,
      mock: JSON.stringify({ claims: [] }),
    });

    const seen = new Set<string>();
    const claims = extraction.data!.claims.filter((c) => {
      const k = claimKey(c);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const deduped = extraction.data!.claims.length - claims.length;
    if (deduped) ctx.log.info('deduped near-identical claims', { deduped });

    if (claims.length === 0) {
      return {
        writes: { fact_check: { checked: true, claims: [], unsupported_count: 0 } },
        cost_usd: extraction.usage.costUsd,
        notes: 'no checkable claims',
      };
    }

    if (ctx.budget_remaining_usd < MIN_VERIFY_BUDGET_USD) {
      const uncertain: FactCheckClaim[] = claims.map((claim) => ({ claim, verdict: 'uncertain', source: '', note: 'verification skipped: budget nearly exhausted' }));
      ctx.log.warn('skipping claim verification — budget below floor', { remaining: ctx.budget_remaining_usd, claims: claims.length });
      return {
        writes: { fact_check: { checked: true, claims: uncertain, unsupported_count: 0 } },
        cost_usd: extraction.usage.costUsd,
        notes: `${claims.length} claims left uncertain: budget $${ctx.budget_remaining_usd.toFixed(2)} < $${MIN_VERIFY_BUDGET_USD.toFixed(2)} floor`,
      };
    }

    const results = await mapLimit(claims, config().MEDIA_CONCURRENCY, (c) => verifyClaim(c));
    // The per-claim verdict LLM calls are real spend — sum them into this agent's
    // cost, but keep cost_usd OUT of the state records (claims are claim/verdict/source/note).
    const verifyCost = results.reduce((n, r) => n + r.cost_usd, 0);
    const verified: FactCheckClaim[] = results.map(({ cost_usd: _cost, ...claim }) => claim);
    const unsupported = verified.filter((v) => v.verdict === 'unsupported');
    const uncertain = verified.filter((v) => v.verdict === 'uncertain');
    ctx.log.info('claims verified', { claims: verified.length, unsupported: unsupported.length, uncertain: uncertain.length, verifyCost });

    return {
      writes: { fact_check: { checked: true, claims: verified, unsupported_count: unsupported.length } },
      cost_usd: extraction.usage.costUsd + verifyCost,
      notes: `${verified.length} claims: ${verified.length - unsupported.length - uncertain.length} supported, ${unsupported.length} unsupported, ${uncertain.length} uncertain${deduped ? `, ${deduped} deduped` : ''}`,
    };
  },
});
