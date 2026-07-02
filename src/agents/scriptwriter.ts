import type { Agent } from './types.js';
import { ok } from './types.js';
import type { Script } from '../types/episode.js';
import { getLLM } from '../llm/client.js';
import { OutlineSchema, ScriptDraftSchema, CritiqueSchema } from '../schemas/phase1.js';
import { SCRIPT_SYSTEM, buildDraftPrompt, pickLens, SPOKEN_WPM } from '../skills/scriptPrompt.js';
import { buildTechBrief, requiredDisclosureLines, TECH_SECTION_ID } from '../skills/techSegment.js';
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
    const targetWords = Math.round((c.target_length_min || 10) * SPOKEN_WPM);
    // One creative lens for the whole run, shared by outline + draft, so the plan and
    // the prose pull in the same direction (and differ from the previous run).
    const lens = pickLens();
    // Fixed tech-spotlight slot: mode-specific writing rules + the disclosure line
    // come from the tech-segment skill; the brief rides the draft prompt.
    const ts = ctx.state.tech_segment;
    const techBrief = ts?.enabled ? buildTechBrief(ts, ctx.state.channel.languages) : undefined;

    // 1) outline — most capable model; the house style + lens come from the shared system prompt.
    const outline = await llm.complete({
      tier: 'pro', temperature: 0.9, maxTokens: 2000, schema: OutlineSchema,
      system: `${SCRIPT_SYSTEM}\n\nStep 1 of 3 — PLAN ONLY: write multiple distinct hook options and a beat sheet that engineers open loops and payoffs. Each hook variant must be a genuinely different bet — a different emotion, device, or claim — never a rewording of another variant. Make at least one a bold, unexpected choice.`,
      prompt: `Topic: ${c.topic}\nAngle: ${c.angle}\nAudience: ${c.audience}\nCreative lens for THIS script: ${lens}\nTarget: ~${c.target_length_min} min.\n\nReturn ONLY compact JSON: {"hook_variants":[2-4 short plain-text strings],"beat_sheet":[4-9 short plain-text strings]}. Each string is one line of plain text — NOT an object. No prose outside the JSON.`,
      mock: JSON.stringify({
        hook_variants: [
          `Everyone does ${c.topic} the same way. It's quietly costing them — and here's the proof.`,
          `I copied the most popular ${c.topic} advice for 30 days. Most of it backfired.`,
        ],
        beat_sheet: ['Cold-open hook + stakes', 'Name the common belief', 'Show where it breaks (example)', 'The counterintuitive insight', 'The fix, step by step', 'Result / proof', 'Call to action'],
      }),
    });
    const o = outline.data!;

    // 2) draft — most capable model; shared, optimized prompt format.
    const draft = await llm.complete({
      tier: 'pro', temperature: 0.7, maxTokens: 8000, schema: ScriptDraftSchema,
      system: `${SCRIPT_SYSTEM}\n\nStep 2 of 3 — WRITE the full narration. Each section names its beat and the retention device keeping the viewer watching, with a visual note and short on-screen text.`,
      prompt: buildDraftPrompt({
        topic: c.topic, angle: c.angle, hostMode: host,
        hook: o.hook_variants[0]!, beats: o.beat_sheet, targetWords,
        minSections: 5, maxSections: ts?.enabled ? 10 : 9, lens, techBrief,
      }),
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
      system: 'You are a ruthless retention editor. Grade the hook and structure, and name every weakness you find — including minor ones; do not filter for importance. Always attempt a stronger revised_hook; omit it only if the existing hook already beats your best attempt.',
      prompt: `Hook: ${d.hook}\nSections: ${d.sections.map((s) => s.beat).join(' | ')}\n\nReturn JSON {passes:boolean, critique:string, revised_hook?:string}.`,
      mock: JSON.stringify({ passes: true, critique: 'Hook lands; open loops resolve; CTA is specific.', revised_hook: undefined }),
    });
    const cr = critique.data!;
    const finalHook = cr.revised_hook && cr.revised_hook.length > 8 ? cr.revised_hook : d.hook;

    const sections = d.sections.map((s, i) => ({
      id: s.id || `s${i + 1}`, beat: s.beat, vo_text: s.vo_text, shot_note: s.shot_note, on_screen: s.on_screen, retention_device: s.retention_device,
    }));

    // Deterministic tech-slot guarantee (the segment is format, disclosure is compliance —
    // neither is left to model compliance-with-instructions):
    //   - normalize the tech section's id to the hard contract (visuals/QA find it by id)
    //   - ensure a required disclosure line is present verbatim (append if the model dropped it)
    //   - if the model produced no tech section at all, append a minimal one from the brief
    if (ts?.enabled) {
      const lines = requiredDisclosureLines(ts, ctx.state.channel.languages);
      const idx = sections.findIndex((x) => x.id === TECH_SECTION_ID || /tech/i.test(x.beat));
      if (idx >= 0) {
        const sec = sections[idx]!;
        sec.id = TECH_SECTION_ID;
        if (!lines.some((l) => sec.vo_text.includes(l))) sec.vo_text = `${sec.vo_text.trim()} ${lines[0]}`;
      } else {
        const ctaAt = sections.length;  // insert before nothing → append just ahead of CTA delivery
        sections.splice(ctaAt, 0, {
          id: TECH_SECTION_ID, beat: 'tech spotlight',
          vo_text: `One more thing worth knowing about ${ts.topic}: ${ts.tie_in}. ${lines[0]}`,
          shot_note: ts.mode === 'explainer' ? 'concept b-roll / motion graphic' : `product footage: ${ts.product?.name ?? ts.topic} (official press assets)`,
          on_screen: ts.topic.split(' ').slice(0, 5).join(' '),
          retention_device: 'pattern interrupt',
        });
        log.warn('model omitted the tech section; appended deterministic fallback', { topic: ts.topic, mode: ts.mode });
      }
    }
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
