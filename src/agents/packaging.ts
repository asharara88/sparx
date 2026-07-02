import type { Agent } from './types.js';
import { ok } from './types.js';
import { getLLM } from '../llm/client.js';
import { PackagingSchema } from '../schemas/phase34.js';
import { getImage } from '../media/image.js';
import { canAfford } from '../producer/budget.js';
import { estimateImageCost } from '../skills/cost.js';
import { createLogger } from '../logger.js';

// Agent 10 — Thumbnail & Packaging. LLM generates CTR-tuned titles/descriptions/
// thumbnail concepts, then the image provider (Runway gen4_image) renders actual
// thumbnails from the top concepts (budget-aware). Blocks Publishing.
const MAX_THUMBS = 2;

export const packaging: Agent = {
  name: 'packaging',
  async run(ctx) {
    const log = createLogger({ agent: 'packaging', episode: ctx.episode_id });
    const llm = getLLM();
    const c = ctx.state.concept;

    const out = await llm.complete({
      tier: 'pro', temperature: 0.8, schema: PackagingSchema,   // Opus: titles drive CTR — the click
      system: 'You are a YouTube packaging expert writing for a broad, general audience. Write high-CTR titles (curiosity + clarity, <70 chars), compelling descriptions with keywords, and distinct thumbnail concepts described as vivid image prompts. Use plain, everyday words — no jargon, acronyms, or technical/insider terms a casual viewer wouldn\'t instantly understand. Titles and descriptions should read at a ~6th-8th-grade level. ' +
        'Each title must test a different strategy (e.g. curiosity gap, bold claim, mistake/negative frame, outcome promise) — never variants of one phrasing. Each thumbnail concept must be a visually distinct idea, not the same scene redressed.',
      prompt: `Topic: ${c.topic}\nAngle: ${c.angle}\nHook: ${ctx.state.script.hook}\nAudience: ${c.audience}\nKeywords: ${c.keywords.join(', ')}\n\nReturn JSON {titles[3-5], descriptions[1-2], thumbnail_concepts[2-3]}.`,
      mock: JSON.stringify({
        titles: [c.working_title || c.topic, `The ${c.topic} mistake costing you`, `Why your ${c.topic} isn't working`],
        descriptions: [`${c.angle}\n\nIn this video: ${c.keywords.slice(0, 5).join(', ')}.`],
        thumbnail_concepts: [c.thumbnail_concept || 'before/after split with bold overlay', 'shocked face + red arrow on the key metric'],
      }),
    });
    const p = out.data!;

    // Render actual thumbnails from the top concepts (budget-aware).
    const image = getImage();
    const thumbnails: string[] = [];
    let cost = out.usage.costUsd;
    for (const concept of p.thumbnail_concepts.slice(0, MAX_THUMBS)) {
      if (!canAfford(ctx.state, cost + estimateImageCost())) { log.warn('skipping thumbnail render (budget)'); break; }
      try {
        const art = await image.generate({ prompt: `YouTube thumbnail, bold and high-contrast: ${concept}`, ratio: '1920:1080' });
        thumbnails.push(art.uri);
        cost += art.costUsd;
      } catch (err) {
        log.warn('thumbnail render failed', { err: String(err) });
      }
    }
    // Fall back to storing the concepts as text if nothing rendered.
    const finalThumbs = thumbnails.length ? thumbnails : p.thumbnail_concepts;

    log.info('packaged', { titles: p.titles.length, thumbnails: finalThumbs.length, rendered: thumbnails.length, imageProvider: image.name });
    return ok(ctx, { packaging: { thumbnails: finalThumbs, titles: p.titles, descriptions: p.descriptions } }, cost,
      `${p.titles.length} titles, ${thumbnails.length} rendered thumbs (${image.name})`);
  },
};
