import type { Agent } from './types.js';
import { ok } from './types.js';
import type { Short } from '../types/episode.js';
import { getLLM } from '../llm/client.js';
import { ShortsPlanSchema } from '../schemas/phase34.js';
import { sectionTimes } from '../producer/timeline.js';
import { createLogger } from '../logger.js';

// Agent 9 — Shorts / Repurposing. LLM picks high-retention spans (by section);
// section ranges become time ranges via the shared shot timeline, so the clips
// land where the content actually sits in the rendered cut.
export const shorts: Agent = {
  name: 'shorts',
  async run(ctx) {
    const log = createLogger({ agent: 'shorts', episode: ctx.episode_id });
    const llm = getLLM();
    const secs = ctx.state.script.sections;

    const { startBySec, durBySec } = sectionTimes(ctx.state);
    const endOf = (id: string) => (startBySec.get(id) ?? 0) + (durBySec.get(id) ?? 0);

    const plan = await llm.complete({
      tier: 'fast', temperature: 0.6, schema: ShortsPlanSchema,
      system: 'You select the most clippable, high-retention moments of a video for vertical Shorts. Each short is a contiguous span of sections with a punchy standalone hook.',
      prompt: `Sections:\n${secs.map((s) => `- ${s.id} [${s.beat}] ${s.vo_text.slice(0, 80)}`).join('\n')}\n\nReturn JSON {shorts:[{start_section,end_section,hook,why}]} (1-3).`,
      mock: JSON.stringify({ shorts: [{ start_section: secs[0]?.id ?? 's1', end_section: secs[Math.min(1, secs.length - 1)]?.id ?? 's1', hook: ctx.state.script.hook.slice(0, 80), why: 'strong cold open' }] }),
    });

    const out: Short[] = plan.data!.shorts.map((sp, i): Short => ({
      short_id: `short_${i + 1}`,
      source_range_s: [startBySec.get(sp.start_section) ?? 0, endOf(sp.end_section)],
      render_uri: `render://${ctx.episode_id}/short_${i + 1}.mp4`,
      hook: sp.hook,
    }));
    log.info('shorts planned', { count: out.length, provider: llm.live ? 'llm' : 'mock' });
    return ok(ctx, { shorts: out }, plan.usage.costUsd, `${out.length} shorts`);
  },
};
