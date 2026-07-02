import type { Agent } from './types.js';
import { ok } from './types.js';
import type { TechSegment } from '../types/episode.js';
import { getLLM } from '../llm/client.js';
import { TechCandidatesSchema, TechSignalsSchema, decideMode, disclosureFor } from '../skills/techSegment.js';
import { createLogger } from '../logger.js';
import { AgentError } from '../errors.js';

// Agent 1b — Tech Segment Planner (auto-run, no extra gate; rides GATE A with the concept):
//   1) propose 3-6 health×tech candidates relevant to THIS episode's topic, UAE/KSA-aware
//   2) pick the best by relevance (deterministic); below threshold → segment disabled
//   3) extract rubric signals for the pick (schema-validated)
//   4) decideMode() — deterministic rubric; regulatory murkiness always forces explainer
// Everything that drove the call (candidates, signals, trace) is written to state.
const MIN_RELEVANCE = 5;

export const techSegmentPlanner: Agent = {
  name: 'tech_segment_planner',
  async run(ctx) {
    const log = createLogger({ agent: 'tech_segment_planner', episode: ctx.episode_id });
    const c = ctx.state.concept;
    if (!c.topic) throw new AgentError('tech_segment_planner', 'no concept to plan a tech segment for');
    const llm = getLLM();

    // 1) candidates — fast tier; the creative call already happened in research.
    const cand = await llm.complete({
      tier: 'fast', temperature: 0.7, maxTokens: 1200, schema: TechCandidatesSchema,
      system: 'You surface health/wellness TECH angles (wearables, CGMs, peptides, AI health tools, recovery devices, supplements-tech) genuinely relevant to a given episode topic, for a skeptical evidence-first show with a UAE/KSA (Gulf) audience. Prefer items with real regional interest. Be specific: name real products or real categories.',
      prompt: `Episode topic: ${c.topic}\nAngle: ${c.angle}\nAudience: ${c.audience}\n\nReturn ONLY JSON {"candidates":[3-6 of {"name","kind":"product"|"category","relevance":0-10 fit with THIS topic,"why"}]}.`,
      mock: JSON.stringify({
        candidates: [
          { name: 'Oura Ring 4', kind: 'product', relevance: 8, why: 'directly measures what the episode discusses; strong Gulf availability' },
          { name: 'GLP-1 peptides', kind: 'category', relevance: 6, why: 'high regional search interest; evidence status worth explaining' },
        ],
      }),
    });
    const candidates = [...cand.data!.candidates].sort((a, b) => b.relevance - a.relevance);
    const top = candidates[0]!;

    // 2) relevance gate — never force an irrelevant tech beat into an episode.
    if (top.relevance < MIN_RELEVANCE) {
      const tech_segment: TechSegment = {
        enabled: false, mode: 'explainer', topic: '', tie_in: '',
        product: null, candidates, signals: { specific_product_exists: false, gulf_available: false, claims_testable: false, regulatory_murky: false, category_or_concept: false },
        decision_trace: `best candidate "${top.name}" scored ${top.relevance} < ${MIN_RELEVANCE} → segment disabled for this episode`,
        sponsored: false, disclosure: disclosureFor(false),
      };
      log.info('tech segment disabled (low relevance)', { top: top.name, relevance: top.relevance });
      return ok(ctx, { tech_segment }, cand.usage.costUsd, `tech segment: disabled (top ${top.relevance}/10)`);
    }

    // 3) signals — the rubric inputs, extracted per pick and schema-validated.
    const sig = await llm.complete({
      tier: 'fast', temperature: 0.2, maxTokens: 600, schema: TechSignalsSchema,
      system: 'You assess a health-tech item for a Gulf (UAE/KSA) audience. Be conservative: if regulatory status in the Gulf is unclear or the item is not approved there (most peptides are not), regulatory_murky is true. gulf_available means officially purchasable in UAE or KSA today.',
      prompt: `Item: ${top.name} (${top.kind})\nEpisode topic: ${c.topic}\n\nReturn ONLY JSON {"specific_product_exists":bool,"gulf_available":bool,"claims_testable":bool,"regulatory_murky":bool,"category_or_concept":bool,"product_name":string,"product_category":string,"gulf_availability":one short plain line}.`,
      mock: JSON.stringify(
        top.kind === 'product'
          ? { specific_product_exists: true, gulf_available: true, claims_testable: true, regulatory_murky: false, category_or_concept: false, product_name: top.name, product_category: 'wearable', gulf_availability: 'sold via Amazon.ae and Noon' }
          : { specific_product_exists: false, gulf_available: false, claims_testable: false, regulatory_murky: true, category_or_concept: true, product_name: '', product_category: '', gulf_availability: '' }
      ),
    });
    const s = sig.data!;

    // 4) deterministic mode decision. sponsored defaults to false; flipping it to
    // true (pre-script, by a human or a sponsor integration) switches the copy to
    // the mandatory paid-partnership disclosure, which QA then enforces as blocking.
    const { mode, trace } = decideMode(s);
    const sponsored = false;
    const tech_segment: TechSegment = {
      enabled: true, mode,
      topic: top.name,
      tie_in: top.why,
      product: mode !== 'explainer' && s.product_name
        ? { name: s.product_name, category: s.product_category, gulf_availability: s.gulf_availability }
        : null,
      candidates,
      signals: {
        specific_product_exists: s.specific_product_exists, gulf_available: s.gulf_available,
        claims_testable: s.claims_testable, regulatory_murky: s.regulatory_murky, category_or_concept: s.category_or_concept,
      },
      decision_trace: trace,
      sponsored,
      disclosure: disclosureFor(sponsored),
    };
    const cost = cand.usage.costUsd + sig.usage.costUsd;
    log.info('tech segment planned', { topic: top.name, mode, trace });
    return ok(ctx, { tech_segment }, cost, `tech: ${top.name} → ${mode}`);
  },
};
