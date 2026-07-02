import { defineAgent } from './core.js';
import { getLLM } from '../llm/client.js';
import { PackagingSchema } from '../schemas/phase34.js';
import { getImage } from '../media/image.js';
import { config } from '../config.js';
import { settleLimit } from '../util/concurrency.js';
import { cachedArtifact, contentKey } from '../skills/artifactCache.js';
import { estimateImageCost, shouldThrottle } from '../skills/costModel.js';
import { pastTopics } from '../skills/channelMemory.js';
import { clusterKeywords } from '../skills/research/seo.js';

// Agent 10 — Thumbnail & Packaging. LLM generates CTR-tuned titles/descriptions/
// thumbnail concepts; the script's pro-tier hook variants join the title pool
// (previously paid for and then discarded); channel memory supplies recent titles
// as "avoid these patterns"; the image provider renders the top concepts in
// PARALLEL through the artifact cache (retries never re-bill), budget-gated
// before any image spend. Blocks Publishing.
const MAX_THUMBS = 2;

export const packaging = defineAgent({
  name: 'packaging',
  description: 'CTR packaging: titles (LLM + script hook variants), descriptions, and thumbnails rendered in parallel via the artifact cache, budget-gated.',
  skills: ['seo-keywords', 'channel-memory', 'cost-model', 'artifact-cache'],
  reads: ['concept', 'script', 'qa', 'budget'],
  writes: ['packaging'],
  requires: (s) => (s.concept.topic ? null : 'no concept topic to package'),

  async execute(ctx) {
    const llm = getLLM();
    const c = ctx.state.concept;

    // Primary search phrases for titles/tags + recent channel titles to avoid repeating.
    const seo = clusterKeywords(c.topic, c.keywords);
    const recentTitles = pastTopics(10).map((p) => p.title).filter(Boolean);
    const avoid = recentTitles.length
      ? `\nAvoid repeating these recent title patterns from the channel:\n${recentTitles.map((t) => `- ${t}`).join('\n')}`
      : '';
    const disclosure = ctx.state.qa.ai_disclosure_required
      ? '\nNote: the video contains AI-generated visuals — titles must not imply real or undercover footage.'
      : '';

    const out = await llm.complete({
      tier: 'pro', temperature: 0.8, schema: PackagingSchema,   // Opus: titles drive CTR — the click
      system: 'You are a YouTube packaging expert writing for a broad, general audience. Write high-CTR titles (curiosity + clarity, <70 chars), compelling descriptions with keywords, and distinct thumbnail concepts described as vivid image prompts. Use plain, everyday words — no jargon, acronyms, or technical/insider terms a casual viewer wouldn\'t instantly understand. Titles and descriptions should read at a ~6th-8th-grade level.',
      prompt: `Topic: ${c.topic}\nAngle: ${c.angle}\nHook: ${ctx.state.script.hook}\nAudience: ${c.audience}\nKeywords: ${c.keywords.join(', ')}\nPrimary search phrases: ${seo.primary.join(', ')}${avoid}${disclosure}\n\nReturn JSON {titles[3-5], descriptions[1-2], thumbnail_concepts[2-3]}.`,
      mock: JSON.stringify({
        titles: [c.working_title || c.topic, `The ${c.topic} mistake costing you`, `Why your ${c.topic} isn't working`],
        descriptions: [`${c.angle}\n\nIn this video: ${c.keywords.slice(0, 5).join(', ')}.`],
        thumbnail_concepts: [c.thumbnail_concept || 'before/after split with bold overlay', 'shocked face + red arrow on the key metric'],
      }),
    });
    const p = out.data!;
    let cost = out.usage.costUsd;

    // Title pool: LLM titles + the script's hook variants (generated at pro tier
    // "for A/B" and previously consumed by nothing downstream).
    const hookTitles = ctx.state.script.hook_variants.map((h) => h.trim()).filter((h) => h.length >= 4 && h.length <= 100);
    const titles = dedupe([...p.titles, ...hookTitles]);

    // Budget-gate the render batch BEFORE spending (cache hits cost 0, so the
    // per-image estimate is conservative), then render in parallel via the cache.
    const image = getImage();
    const toRender: string[] = [];
    for (const concept of p.thumbnail_concepts.slice(0, MAX_THUMBS)) {
      if (shouldThrottle(ctx.state, cost + (toRender.length + 1) * estimateImageCost())) {
        ctx.log.warn('skipping thumbnail render (budget)', { planned: toRender.length, concepts: p.thumbnail_concepts.length });
        break;
      }
      toRender.push(concept);
    }
    const results = await settleLimit(toRender, config().MEDIA_CONCURRENCY, async (concept) => {
      const prompt = `YouTube thumbnail, bold and high-contrast: ${concept}`;
      return cachedArtifact(contentKey('thumb', prompt), async () => {
        const art = await image.generate({ prompt, ratio: '1920:1080' });
        return { uri: art.uri, costUsd: art.costUsd };
      });
    });
    for (const f of results.failed) ctx.log.warn('thumbnail render failed', { err: String(f.error).slice(0, 160) });
    const rendered = results.ok.map((o) => o.value);
    cost += rendered.reduce((n, r) => n + r.costUsd, 0);
    const cachedHits = rendered.filter((r) => r.cached).length;

    // Fall back to storing the concepts as text if nothing rendered.
    const thumbnails = rendered.length ? rendered.map((r) => r.uri) : p.thumbnail_concepts;

    ctx.log.info('packaged', { titles: titles.length, hookVariants: hookTitles.length, rendered: rendered.length, cached: cachedHits, imageProvider: image.name });
    return {
      writes: { packaging: { thumbnails, titles, descriptions: p.descriptions } },
      cost_usd: cost,
      notes: `${titles.length} titles (${hookTitles.length} from hook variants), ${rendered.length} rendered thumbs (${cachedHits} cached, ${image.name})`,
    };
  },
});

function dedupe(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    const k = x.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(x); }
  }
  return out;
}
