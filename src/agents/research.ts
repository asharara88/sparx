import type { Agent } from './types.js';
import { ok } from './types.js';
import type { Concept } from '../types/episode.js';
import { getLLM } from '../llm/client.js';
import { IdeationSchema, ConceptOutputSchema } from '../schemas/phase1.js';
import { webResearch } from '../skills/research/webSearch.js';
import { clusterKeywords } from '../skills/research/seo.js';
import { createLogger } from '../logger.js';
import { AgentError } from '../errors.js';

// Agent 1 — Research & Ideation (multi-step):
//   1) gather live web context (web-search skill)
//   2) ideate 3-8 candidate angles informed by that context
//   3) score, select the best, and package a full concept (audience, title, thumbnail, keywords)
// All LLM outputs are schema-validated. → GATE A.
export const research: Agent = {
  name: 'research',
  async run(ctx) {
    const log = createLogger({ agent: 'research', episode: ctx.episode_id });
    const { niche, languages } = ctx.state.channel;
    const llm = getLLM();
    const past = ctx.state.history.filter((h) => h.event.includes('concept')).map((h) => h.event);

    // 1) live context
    const [ctx1, ctx2] = await Promise.all([
      webResearch(`${niche} trending topics 2026`, 6),
      webResearch(`most viewed ${niche} youtube videos`, 6),
    ]);
    const evidence = [...ctx1.results, ...ctx2.results].map((r) => `- ${r.title}: ${r.snippet}`).join('\n').slice(0, 2500);
    log.info('gathered web context', { results: ctx1.results.length + ctx2.results.length, live: ctx1.live });

    // 2) ideation
    const ideation = await llm.complete({
      tier: 'pro',          // Opus: the angle is the highest-leverage creative call after the script
      temperature: 0.9,
      schema: IdeationSchema,
      system: 'You are a sharp YouTube strategist. Generate distinctive, specific angles with real retention potential. Avoid generic listicles and anything already saturated. ' +
        'Make the candidates genuinely different bets — different mechanisms (contrarian take, experiment, investigation, story, teardown) and different emotional drivers — not rephrasings of one idea. ' +
        'Include at least one unexpected, off-distribution angle a competitor in this niche would not think to make.',
      prompt: `Niche: ${niche}\nLanguages: ${languages.join(', ')}\nAvoid past topics: ${past.join('; ') || '(none)'}\n\nWeb context:\n${evidence}\n\nReturn JSON {"candidates":[{"angle","why"}]} with 3-6 candidates.`,
      mock: JSON.stringify({
        candidates: [
          { angle: `The ${niche} workflow everyone copies is quietly costing them — here's the fix`, why: 'Strong curiosity gap + practical payoff' },
          { angle: `I tested the top ${niche} advice for 30 days; most of it failed`, why: 'Proof-driven, personal stakes' },
          { angle: `Why beginners plateau in ${niche} (and the one shift that breaks it)`, why: 'Targets a felt pain point' },
        ],
      }),
    });
    const candidates = ideation.data!.candidates;

    // 3) score + select + package
    const concept = await llm.complete({
      tier: 'pro',          // Opus: scoring/selecting the strongest angle + sharp working title
      temperature: 0.4,
      schema: ConceptOutputSchema,
      system: 'You are a YouTube packaging expert. Score angles 0-10 on curiosity, payoff, differentiation, and search demand; pick the best; then package a full concept. Be concrete. ' +
        'Score analytically and consistently — the same angle should always earn the same score. Creativity belongs in the packaging fields (title, thumbnail concept), not in the scoring.',
      prompt: `Niche: ${niche}\nCandidate angles:\n${candidates.map((c, i) => `${i + 1}. ${c.angle} (${c.why})`).join('\n')}\n\nWeb context:\n${evidence}\n\nReturn JSON matching: {topic, working_title, angle, rationale, audience, thumbnail_concept, scored:[{angle,score,why}], keywords[3-12], competitor_refs[], target_length_min}.`,
      mock: JSON.stringify({
        topic: `${niche}: the workflow mistake`,
        working_title: `The ${niche} Mistake That's Costing You`,
        angle: candidates[0]!.angle,
        rationale: 'Curiosity gap + concrete fix; competitors only cover the surface version.',
        audience: `intermediate ${niche} practitioners who feel stuck`,
        thumbnail_concept: 'split frame: messy "before" workflow vs clean "after", bold 3-word overlay',
        scored: candidates.map((c, i) => ({ angle: c.angle, score: 9 - i, why: c.why })),
        keywords: [niche, `${niche} workflow`, `${niche} mistakes`, `${niche} tips 2026`, `best ${niche} setup`],
        competitor_refs: ctx2.results.slice(0, 2).map((r) => r.title),
        target_length_min: 10,
      }),
    });
    const c = concept.data;
    if (!c) throw new AgentError('research', 'concept packaging returned no data');

    const seo = clusterKeywords(c.topic, c.keywords);
    const out: Concept = {
      topic: c.topic,
      working_title: c.working_title,
      angle: c.angle,
      rationale: c.rationale,
      audience: c.audience,
      thumbnail_concept: c.thumbnail_concept,
      angle_candidates: c.scored.map((s) => ({ angle: s.angle, score: s.score, why: s.why })),
      keywords: Array.from(new Set<string>([...seo.primary, ...c.keywords])).slice(0, 12),
      competitor_refs: c.competitor_refs ?? [],
      target_length_min: c.target_length_min,
      approved: false,
    };
    const cost = ideation.usage.costUsd + concept.usage.costUsd;
    return ok(ctx, { concept: out }, cost, llm.live ? `llm concept (${out.angle_candidates.length} angles scored)` : 'mock concept');
  },
};
