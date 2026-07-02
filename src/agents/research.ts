import { defineAgent } from './core.js';
import type { Concept } from '../types/episode.js';
import { getLLM } from '../llm/client.js';
import { IdeationSchema, ConceptOutputSchema } from '../schemas/phase1.js';
import { webResearch, type SearchResult } from '../skills/research/webSearch.js';
import { clusterKeywords } from '../skills/research/seo.js';
import { pastTopics } from '../skills/channelMemory.js';

// Agent 1 — Research & Ideation (multi-step):
//   1) gather live web context (web-research skill) — enrichment only, a search
//      outage degrades to empty evidence instead of failing the run
//   2) ideate 3-8 candidate angles informed by that context
//   3) score, select the best, and package a full concept (audience, title, thumbnail, keywords)
// Topic dedup reads cross-episode channel memory (per-episode history only ever
// holds event strings, never topics). All LLM outputs are schema-validated. → GATE A.

const EVIDENCE_CHARS = 2500;

export const research = defineAgent({
  name: 'research',
  description: 'Gather web context, ideate candidate angles, and package the strongest into a full validated concept.',
  skills: ['web-research', 'seo-keywords', 'channel-memory'],
  reads: ['channel', 'history'],
  writes: ['concept'],
  requires: (s) => (s.channel.niche ? null : 'channel.niche is empty — nothing to ideate on'),

  async execute(ctx) {
    const { niche, languages } = ctx.state.channel;
    const llm = getLLM();
    const notes: string[] = [];
    const year = new Date().getFullYear();

    // Gate-A "revise" sends the creator's notes here; a CLI-seeded topic arrives
    // as concept.topic with no angle yet (a revised concept always has one).
    const revisionNotes = typeof ctx.params?.revision_notes === 'string' ? ctx.params.revision_notes : '';
    const requestedTopic = !ctx.state.concept.angle ? ctx.state.concept.topic : '';
    const priorAngle = revisionNotes ? ctx.state.concept.angle : '';
    const directives = [
      requestedTopic ? `The creator requested this topic — ideate angles FOR it, not around it: "${requestedTopic}"` : '',
      priorAngle ? `Previous concept under revision: "${priorAngle}"` : '',
      revisionNotes ? `Creator revision notes — every candidate must address them: ${revisionNotes}` : '',
    ].filter(Boolean).join('\n');
    if (revisionNotes) notes.push('revised per creator notes');

    // Real dedup source: channel memory carries past episodes' topics/titles.
    const past = pastTopics().map((p) => p.topic || p.title).filter(Boolean);

    // Two expensive calls follow; when the budget is nearly gone, degrade the tier instead of spending Opus money.
    const tier = ctx.budget_remaining_usd < 1 ? ('main' as const) : ('pro' as const);
    if (tier === 'main') notes.push(`budget low ($${ctx.budget_remaining_usd.toFixed(2)} left): pro-tier calls downgraded to main`);

    // 1) live context
    let results: SearchResult[] = [];
    try {
      const [trending, topVideos] = await Promise.all([
        webResearch(`${niche} trending topics ${year}`, 6),
        webResearch(`most viewed ${niche} youtube videos`, 6),
      ]);
      results = [...trending.results, ...topVideos.results];
      ctx.log.info('gathered web context', { results: results.length, live: trending.live });
    } catch (err) {
      notes.push('web research unavailable; ideated without evidence');
      ctx.log.warn('web research failed — proceeding with empty evidence', { err: String(err).slice(0, 160) });
    }
    const evidence = results.map((r) => `- ${r.title}: ${r.snippet}`).join('\n').slice(0, EVIDENCE_CHARS);

    // 2) ideation
    const ideation = await llm.complete({
      tier,                 // pro (Opus) unless budget-degraded: the angle is the highest-leverage creative call after the script
      temperature: 0.9,
      schema: IdeationSchema,
      system: 'You are a sharp YouTube strategist. Generate distinctive, specific angles with real retention potential. Avoid generic listicles and anything already saturated.',
      prompt: `Niche: ${niche}\nLanguages: ${languages.join(', ')}\nAvoid these past episode topics: ${past.join('; ') || '(none)'}${directives ? `\n${directives}` : ''}\n\nWeb context:\n${evidence}\n\nReturn JSON {"candidates":[{"angle","why"}]} with 3-8 candidates.`,
      mock: JSON.stringify({
        candidates: [
          { angle: `The ${niche} workflow everyone copies is quietly costing them — here's the fix`, why: 'Strong curiosity gap + practical payoff' },
          { angle: `I tested the top ${niche} advice for 30 days; most of it failed`, why: 'Proof-driven, personal stakes' },
          { angle: `Why beginners plateau in ${niche} (and the one shift that breaks it)`, why: 'Targets a felt pain point' },
        ],
      }),
    });
    const candidates = ideation.data!.candidates;   // schema'd complete throws rather than return undefined data

    // 3) score + select + package
    const concept = await llm.complete({
      tier,
      temperature: 0.4,
      schema: ConceptOutputSchema,
      system: 'You are a YouTube packaging expert. Score angles 0-10 on curiosity, payoff, differentiation, and search demand; pick the best; then package a full concept. Be concrete.',
      prompt: `Niche: ${niche}${directives ? `\n${directives}` : ''}\nCandidate angles:\n${candidates.map((c, i) => `${i + 1}. ${c.angle} (${c.why})`).join('\n')}\n\nWeb context:\n${evidence}\n\nReturn JSON matching: {topic, working_title, angle, rationale, audience, thumbnail_concept, scored:[{angle,score,why}], keywords[3-12], competitor_refs[], target_length_min}.`,
      mock: JSON.stringify({
        topic: `${niche}: the workflow mistake`,
        working_title: `The ${niche} Mistake That's Costing You`,
        angle: candidates[0]!.angle,
        rationale: 'Curiosity gap + concrete fix; competitors only cover the surface version.',
        audience: `intermediate ${niche} practitioners who feel stuck`,
        thumbnail_concept: 'split frame: messy "before" workflow vs clean "after", bold 3-word overlay',
        scored: candidates.map((c, i) => ({ angle: c.angle, score: 9 - i, why: c.why })),
        keywords: [niche, `${niche} workflow`, `${niche} mistakes`, `${niche} tips ${year}`, `best ${niche} setup`],
        competitor_refs: results.slice(0, 2).map((r) => r.title),
        target_length_min: 10,
      }),
    });
    const c = concept.data!;

    // Cluster labels of multi-keyword groups are shared themes — stronger tag
    // candidates than any single phrase, so they join primary in the final list.
    const seo = clusterKeywords(c.topic, c.keywords);
    const clusterLabels = seo.clusters.filter((cl) => cl.keywords.length > 1).map((cl) => cl.label);
    const out: Concept = {
      topic: c.topic,
      working_title: c.working_title,
      angle: c.angle,
      rationale: c.rationale,
      audience: c.audience,
      thumbnail_concept: c.thumbnail_concept,
      angle_candidates: c.scored.map((s) => ({ angle: s.angle, score: s.score, why: s.why })),
      keywords: Array.from(new Set<string>([...seo.primary, ...clusterLabels, ...c.keywords])).slice(0, 12),
      competitor_refs: c.competitor_refs ?? [],
      target_length_min: c.target_length_min,
      approved: false,
    };
    notes.unshift(llm.live ? `llm concept (${out.angle_candidates.length} angles scored)` : 'mock concept');
    return {
      writes: { concept: out },
      cost_usd: ideation.usage.costUsd + concept.usage.costUsd,
      notes: notes.join('; '),
    };
  },
});
