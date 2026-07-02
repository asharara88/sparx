import { defineAgent } from './core.js';
import type { Short } from '../types/episode.js';
import { getLLM } from '../llm/client.js';
import { ShortsPlanSchema } from '../schemas/phase34.js';
import { validateRefs } from '../skills/referenceValidation.js';

// Agent 9 — Shorts / Repurposing. LLM picks high-retention spans (by section);
// we convert them to REAL time ranges from cumulative voiceover clip durations
// (per-section shot durations as fallback — the editor times its EDL the same
// way). render_uri stays a plan ref: the shorts_renderer cuts the actual
// vertical clips from the rendered episode downstream.

const FALLBACK_SHORT_S = 45;
const MAX_SHORT_S = 60;   // classic Shorts cap; also keeps clips retention-sized

export const shorts = defineAgent({
  name: 'shorts',
  description: 'Select 1-3 high-retention section spans and map them to real time ranges for the shorts renderer.',
  skills: ['reference-validation'],
  reads: ['script', 'voiceover', 'shot_list', 'edit'],
  writes: ['shorts'],
  requires: (s) => (s.script.sections.length === 0 ? 'no script sections to clip' : null),

  async execute(ctx) {
    const secs = ctx.state.script.sections;

    // real per-section durations: voiceover clip first, else the section's summed shot footage
    const voBySec = new Map(ctx.state.voiceover.clips.map((c) => [c.section_id, c.duration_s]));
    const shotDur = new Map<string, number>();
    for (const sh of ctx.state.shot_list) shotDur.set(sh.section_id, (shotDur.get(sh.section_id) ?? 0) + sh.duration_s);
    const durOf = (id: string) => voBySec.get(id) ?? shotDur.get(id) ?? 0;
    const startBySec = new Map<string, number>();
    let total = 0;
    for (const s of secs) { startBySec.set(s.id, total); total += durOf(s.id); }
    if (ctx.state.edit.duration_s > 0) total = Math.min(total, ctx.state.edit.duration_s);
    if (total === 0) return { writes: { shorts: [] }, notes: 'no timing data (voiceover or shot durations); shorts skipped' };   // don't pay for a guaranteed-garbage plan

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
      if (unknown.has(sp.start_section) || unknown.has(sp.end_section) || startI === undefined || endI === undefined || startI > endI) {
        dropped.push(`${sp.start_section}..${sp.end_section}`);
        continue;
      }
      const start = startBySec.get(sp.start_section)!;
      const end = Math.min(startBySec.get(sp.end_section)! + durOf(sp.end_section), total, start + MAX_SHORT_S);
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
