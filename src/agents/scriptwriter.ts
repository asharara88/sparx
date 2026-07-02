import { defineAgent } from './core.js';
import type { Script } from '../types/episode.js';
import { getLLM } from '../llm/client.js';
import { OutlineSchema, ScriptDraftSchema, CritiqueSchema, type ScriptDraft, type Critique } from '../schemas/phase1.js';
import { SCRIPT_SYSTEM, buildDraftPrompt, pickLens, SPOKEN_WPM, BANNED_PHRASES } from '../skills/scriptPrompt.js';
import { buildTechBrief, requiredDisclosureLines, TECH_SECTION_ID } from '../skills/techSegment.js';

// Agent 2 — Scriptwriter (multi-step):
//   1) outline: hook variants + beat sheet
//   2) draft: full sections with retention devices
//   3) self-critique against the ACTUAL narration; a failing grade triggers exactly
//      ONE redraft with the critique fed back, then the result is accepted (both
//      critiques recorded) — the human at GATE B owns further revisions, not a model loop.
// Deterministic post-checks: banned-phrase scan sets brand_voice_pass; a draft under
// 60% of the word target is flagged loudly (never blocked — gates decide). Part of GATE B.

export const scriptwriter = defineAgent({
  name: 'scriptwriter',
  description: 'Outline, draft, and self-critique the full episode narration, with one redraft on a failing critique.',
  skills: ['tech-segment'],
  reads: ['concept', 'channel', 'tech_segment'],
  writes: ['script'],
  requires: (s) => (s.concept.topic ? null : 'no approved concept to write from'),

  async execute(ctx) {
    const c = ctx.state.concept;
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
    let cost = 0;

    // 1) outline — most capable model; the house style + lens come from the shared system prompt.
    const outline = await llm.complete({
      tier: 'pro', temperature: 0.9, maxTokens: 2000, schema: OutlineSchema,
      system: `${SCRIPT_SYSTEM}\n\nStep 1 of 3 — PLAN ONLY: write multiple distinct hook options and a beat sheet that engineers open loops and payoffs.`,
      prompt: `Topic: ${c.topic}\nAngle: ${c.angle}\nAudience: ${c.audience}\nCreative lens for THIS script: ${lens}\nTarget: ~${c.target_length_min} min.\n\nReturn ONLY compact JSON: {"hook_variants":[2-4 short plain-text strings],"beat_sheet":[4-9 short plain-text strings]}. Each string is one line of plain text — NOT an object. No prose outside the JSON.`,
      mock: JSON.stringify({
        hook_variants: [
          `Everyone does ${c.topic} the same way. It's quietly costing them — and here's the proof.`,
          `I copied the most popular ${c.topic} advice for 30 days. Most of it backfired.`,
        ],
        beat_sheet: ['Cold-open hook + stakes', 'Name the common belief', 'Show where it breaks (example)', 'The counterintuitive insight', 'The fix, step by step', 'Result / proof', 'Call to action'],
      }),
    });
    cost += outline.usage.costUsd;
    const o = outline.data!;

    const draftMock = JSON.stringify({
      hook: o.hook_variants[0],
      sections: o.beat_sheet.slice(0, 6).map((beat, i) => ({
        id: `s${i + 1}`, beat,
        vo_text: `${beat}: narration that moves the story forward with specifics.`,
        shot_note: i % 2 === 1 ? 'generated dramatic visual' : 'stock b-roll / talking head',
        on_screen: beat.split(' ').slice(0, 3).join(' '),
        retention_device: i === 0 ? 'open loop' : i % 2 === 1 ? 'pattern interrupt' : 'payoff tease',
      })),
      cta: 'If this reframed how you think, subscribe — one deep dive like this every week.',
    });

    // 2) draft — most capable model; a redraft feeds the failing critique back into the same prompt.
    const draftOnce = async (critiqueNotes?: string): Promise<ScriptDraft> => {
      const res = await llm.complete({
        tier: 'pro', temperature: 0.7, maxTokens: 8000, schema: ScriptDraftSchema,
        system: `${SCRIPT_SYSTEM}\n\nStep 2 of 3 — WRITE the full narration. Each section names its beat and the retention device keeping the viewer watching, with a visual note and short on-screen text.`,
        prompt: buildDraftPrompt({
          topic: c.topic, angle: c.angle, hostMode: host,
          hook: o.hook_variants[0]!, beats: o.beat_sheet, targetWords,
          minSections: 5, maxSections: ts?.enabled ? 10 : 9, lens, techBrief,
        }) + (critiqueNotes ? `\n\nAn editor rejected the previous draft. Fix these issues in this rewrite:\n${critiqueNotes}` : ''),
        mock: draftMock,
      });
      cost += res.usage.costUsd;
      return res.data!;
    };

    // 3) self-critique — judges the narration itself (hook + per-section vo_text), not beat labels.
    const critiqueOnce = async (d: ScriptDraft): Promise<Critique> => {
      const narration = d.sections.map((s) => `[${s.beat}] ${s.vo_text}`).join('\n').slice(0, 4000);
      const res = await llm.complete({
        tier: 'fast', temperature: 0.3, schema: CritiqueSchema,
        system: 'You are a ruthless retention editor. Grade the hook and the narration against retention: open loops, payoffs, specificity, pacing. If the hook can be sharper, provide a stronger one.',
        prompt: `Hook: ${d.hook}\n\nNarration:\n${narration}\n\nReturn JSON {passes:boolean, critique:string, revised_hook?:string}.`,
        mock: JSON.stringify({ passes: true, critique: 'Hook lands; open loops resolve; CTA is specific.' }),
      });
      cost += res.usage.costUsd;
      return res.data!;
    };

    let d = await draftOnce();
    let cr = await critiqueOnce(d);
    const critiques = [cr.critique];
    let redrafted = false;
    if (!cr.passes) {
      d = await draftOnce(cr.critique);
      cr = await critiqueOnce(d);
      critiques.push(cr.critique);
      redrafted = true;
      ctx.log.info('redrafted after failing critique', { critique: critiques[0]!.slice(0, 120) });
    }
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
        ctx.log.warn('model omitted the tech section; appended deterministic fallback', { topic: ts.topic, mode: ts.mode });
      }
    }
    const word_count = sections.reduce((n, s) => n + s.vo_text.split(/\s+/).filter(Boolean).length, 0);

    // Deterministic checks — they flag for GATE B, never block (mock drafts stay green).
    const spoken = [finalHook, ...sections.map((s) => s.vo_text), d.cta].join(' ').toLowerCase();
    const banned = BANNED_PHRASES.filter((p) => spoken.includes(p.toLowerCase())); // canonical case-insensitive check (matches brandCompliance)
    const tooShort = word_count < Math.round(targetWords * 0.6);

    const critiqueLog = [
      redrafted ? `draft 1 critique (failed): ${critiques[0]}` : critiques[0]!,
      ...(redrafted ? [`redraft critique: ${critiques[1]}`] : []),
      ...(tooShort ? [`LENGTH: ${word_count}w is under 60% of the ~${targetWords}w target`] : []),
      ...(banned.length ? [`BRAND VOICE: contains banned phrase(s): ${banned.join(', ')}`] : []),
    ].join(' | ');

    const script: Script = {
      hook: finalHook, hook_variants: o.hook_variants, beat_sheet: o.beat_sheet,
      sections, cta: d.cta, brand_voice_pass: banned.length === 0, critique: critiqueLog, word_count, approved: false,
    };
    ctx.log.info('script drafted', { sections: sections.length, words: word_count, redrafted, hookRevised: finalHook !== d.hook, banned: banned.length });

    const notes = [
      ...(tooShort ? [`SHORT SCRIPT: ${word_count}w vs ~${targetWords}w target (<60%)`] : []),
      llm.live ? `llm script (${sections.length} sec, ${word_count}w${redrafted ? ', 1 redraft' : ''})` : `mock script (${word_count}w)`,
      ...(banned.length ? [`banned phrases: ${banned.join(', ')}`] : []),
    ].join('; ');
    return { writes: { script }, cost_usd: cost, notes };
  },
});
