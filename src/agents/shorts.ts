import { defineAgent } from './core.js';
import type { Short } from '../types/episode.js';
import { getLLM } from '../llm/client.js';
import { ShortsPlanSchema } from '../schemas/phase34.js';
import { validateRefs } from '../skills/referenceValidation.js';
import { buildTimeline, sectionSpans } from '../skills/timeline.js';

// Agent 9 — Shorts / Repurposing. LLM picks high-retention spans (by section);
// we convert them to REAL time ranges via sectionSpans(buildTimeline) — the
// RENDERED whole-second clock the shorts_renderer actually cuts from cut.mp4
// (a raw VO walk drifts from the rendered file). render_uri stays a plan ref:
// the shorts_renderer cuts the actual vertical clips downstream.

const FALLBACK_SHORT_S = 45;
const MAX_SHORT_S = 60;   // classic Shorts cap; also keeps clips retention-sized

export const shorts = defineAgent({
  name: 'shorts',
  description: 'Select 1-3 high-retention section spans and map them to real time ranges for the shorts renderer.',
  skills: ['reference-validation', 'timeline'],
  reads: ['script', 'voiceover', 'shot_list', 'edit', 'generated_video', 'avatar_clips', 'sourced_assets'],
  writes: ['shorts'],
  requires: (s) => (s.script.sections.length === 0 ? 'no script sections to clip' : null),

  async execute(ctx) {
    const secs = ctx.state.script.sections;

    // Per-section start/duration on the RENDERED clock — the same offsets the
    // shorts_renderer will cut from the real mp4 (never a raw fractional VO walk).
    const spans = sectionSpans(buildTimeline(ctx.state));
    const startBySec = new Map(spans.map((sp) => [sp.section_id, sp.startS]));
    const durBySec = new Map(spans.map((sp) => [sp.section_id, sp.durationS]));
    const durOf = (id: string) => durBySec.get(id) ?? 0;
    let total = spans.reduce((n, sp) => n + sp.durationS, 0);
    if (ctx.state.edit.duration_s > 0) total = Math.min(total, ctx.state.edit.duration_s);
    if (total === 0) return { writes: { shorts: [] }, notes: 'no timing data (no resolvable timeline); shorts skipped' };   // don't pay for a guaranteed-garbage plan

    const llm = getLLM();
    const plan = await llm.complete({
      tier: 'fast', temperature: 0.6, schema: ShortsPlanSchema,
      system: 'You select the most clippable, high-retention moments of a video for vertical Shorts. Each short is a contiguous span of sections with a punchy standalone hook.',
      prompt: `Sections:\n${secs.map((s) => `- ${s.id} [${s.beat}] ${s.vo_text.slice(0, 80)}`).join('\n')}\n\nReturn JSON {shorts:[{start_section,end_section,hook,why}]} (1-3).`,
      mock: JSON.stringify({ shorts: [{ start_section: secs[0]?.id ?? 's1', end_section: secs[Math.min(1, secs.length - 1)]?.id ?? 's1', hook: (ctx.state.script.hook || secs[0]?.vo_text || 'cold open').slice(0, 80), why: 'strong cold open' }] }),
    });

    // validate the LLM's section refs against real ids; unreferenced is expected
    // (a short spans few sections) — only unknown ids and inverted spans matter
    const idx = new Map(secs.map((s, i) => [s.id, i]));
    const report = validateRefs(secs.map((s) => s.id), plan.data!.shorts.flatMap((sp) => [sp.start_section, sp.end_section]));
    const unknown = new Set(report.unknown);

    const out: Short[] = [];
    const dropped: string[] = [];
    for (const sp of plan.data!.shorts) {
      const startI = idx.get(sp.start_section);
      const endI = idx.get(sp.end_section);
      const start = startBySec.get(sp.start_section);
      const endStart = startBySec.get(sp.end_section);
      // a section with no shots never made it into the rendered timeline — its span is unaddressable
      if (unknown.has(sp.start_section) || unknown.has(sp.end_section) || startI === undefined || endI === undefined || startI > endI || start === undefined || endStart === undefined) {
        dropped.push(`${sp.start_section}..${sp.end_section}`);
        continue;
      }
      const end = Math.min(endStart + durOf(sp.end_section), total, start + MAX_SHORT_S);
      if (end <= start) { dropped.push(`${sp.start_section}..${sp.end_section}`); continue; }
      out.push({ short_id: `short_${out.length + 1}`, source_range_s: [start, end], render_uri: `plan://${ctx.episode_id}/short_${out.length + 1}`, hook: sp.hook });
    }
    if (dropped.length) ctx.log.warn('dropped plan items with invalid section refs', { dropped });

    // every plan item was invalid — deterministic first-45s short so distribution still has one
    if (out.length === 0) {
      out.push({ short_id: 'short_1', source_range_s: [0, Math.min(FALLBACK_SHORT_S, total)], render_uri: `plan://${ctx.episode_id}/short_1`, hook: (ctx.state.script.hook || secs[0]!.vo_text).slice(0, 80) });
    }

    ctx.log.info('shorts planned', { count: out.length, dropped: dropped.length, provider: llm.live ? 'llm' : 'mock' });
    return {
      writes: { shorts: out },
      cost_usd: plan.usage.costUsd,
      notes: `${out.length} shorts${dropped.length ? `, ${dropped.length} invalid plan items dropped` : ''}`,
    };
  },
});
