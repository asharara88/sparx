import type { Agent } from './types.js';
import { ok } from './types.js';
import type { Script } from '../types/episode.js';
import { getLLM } from '../llm/client.js';
import { OutlineSchema, ScriptDraftSchema, CritiqueSchema } from '../schemas/phase1.js';
import { createLogger } from '../logger.js';
import { AgentError } from '../errors.js';

// Agent 2 — Scriptwriter (multi-step):
//   1) outline: hook variants + beat sheet
//   2) draft: full sections with retention devices
//   3) self-critique: grade against a retention rubric; apply a stronger hook if found
// Part of GATE B.
export const scriptwriter: Agent = {
  name: 'scriptwriter',
  async run(ctx) {
    const log = createLogger({ agent: 'scriptwriter', episode: ctx.episode_id });
    const c = ctx.state.concept;
    if (!c.topic) throw new AgentError('scriptwriter', 'no approved concept to write from');
    const host = ctx.state.channel.host_mode;
    const llm = getLLM();
    const targetWords = Math.round((c.target_length_min || 10) * 140);

    // 1) outline
    const outline = await llm.complete({
      tier: 'main', temperature: 0.8, schema: OutlineSchema,
      system: 'You are an elite YouTube scriptwriter who obsesses over retention. First plan: write multiple hook options and a beat sheet that engineers open loops and payoffs.',
      prompt: `Topic: ${c.topic}\nAngle: ${c.angle}\nAudience: ${c.audience}\nTarget: ~${c.target_length_min} min.\n\nReturn JSON {hook_variants:[2-4], beat_sheet:[4-9 beats]}.`,
      mock: JSON.stringify({
        hook_variants: [
          `Everyone does ${c.topic} the same way. It's quietly costing them — and here's the proof.`,
          `I copied the most popular ${c.topic} advice for 30 days. Most of it backfired.`,
        ],
        beat_sheet: ['Cold-open hook + stakes', 'Name the common belief', 'Show where it breaks (example)', 'The counterintuitive insight', 'The fix, step by step', 'Result / proof', 'Call to action'],
      }),
    });
    const o = outline.data!;

    // 2) draft
    const draft = await llm.complete({
      tier: 'main', temperature: 0.7, maxTokens: 3500, schema: ScriptDraftSchema,
      system: 'You write natural, spoken-voice narration. Each section names its beat and the retention device keeping the viewer watching. Include a visual note and short on-screen text.',
      prompt: `Topic: ${c.topic}\nAngle: ${c.angle}\nHost mode: ${host}\nChosen hook: ${o.hook_variants[0]}\nBeat sheet: ${o.beat_sheet.join(' | ')}\nTarget ~${targetWords} words.\n\nReturn JSON {hook, sections:[{id,beat,vo_text,shot_note,on_screen,retention_device}] (5-9), cta}.`,
      mock: JSON.stringify({
        hook: o.hook_variants[0],
        sections: o.beat_sheet.slice(0, 6).map((beat, i) => ({
          id: `s${i + 1}`, beat,
          vo_text: `${beat}: narration that moves the story forward with specifics.`,
          shot_note: i % 2 === 1 ? 'generated dramatic visual' : 'stock b-roll / talking head',
          on_screen: beat.split(' ').slice(0, 3).join(' '),
          retention_device: i === 0 ? 'open loop' : i % 2 === 1 ? 'pattern interrupt' : 'payoff tease',
        })),
        cta: 'If this reframed how you think, subscribe — one deep dive like this every week.',
      }),
    });
    const d = draft.data!;

    // 3) self-critique
    const critique = await llm.complete({
      tier: 'fast', temperature: 0.3, schema: CritiqueSchema,
      system: 'You are a ruthless retention editor. Grade the hook and structure. If the hook can be sharper, provide a stronger one.',
      prompt: `Hook: ${d.hook}\nSections: ${d.sections.map((s) => s.beat).join(' | ')}\n\nReturn JSON {passes:boolean, critique:string, revised_hook?:string}.`,
      mock: JSON.stringify({ passes: true, critique: 'Hook lands; open loops resolve; CTA is specific.', revised_hook: undefined }),
    });
    const cr = critique.data!;
    const finalHook = cr.revised_hook && cr.revised_hook.length > 8 ? cr.revised_hook : d.hook;

    const sections = d.sections.map((s, i) => ({
      id: s.id || `s${i + 1}`, beat: s.beat, vo_text: s.vo_text, shot_note: s.shot_note, on_screen: s.on_screen, retention_device: s.retention_device,
    }));
    const word_count = sections.reduce((n, s) => n + s.vo_text.split(/\s+/).filter(Boolean).length, 0);
    const script: Script = {
      hook: finalHook, hook_variants: o.hook_variants, beat_sheet: o.beat_sheet,
      sections, cta: d.cta, brand_voice_pass: true, critique: cr.critique, word_count, approved: false,
    };
    const cost = outline.usage.costUsd + draft.usage.costUsd + critique.usage.costUsd;
    log.info('script drafted', { sections: sections.length, words: word_count, hookRevised: finalHook !== d.hook });
    return ok(ctx, { script }, cost, llm.live ? `llm script (${sections.length} sec, ${word_count}w)` : `mock script (${word_count}w)`);
  },
};
