import { defineAgent } from './core.js';
import type { Shot, TechSegment } from '../types/episode.js';
import { getLLM } from '../llm/client.js';
import { ShotPlanSchema, type ShotPlan } from '../schemas/phase1.js';
import { videoPrompts, type ShotSpec } from '../skills/videoPrompt.js';
import { estimateShotCost, estimateAvatarCost } from '../skills/costModel.js';
import { validateRefs } from '../skills/referenceValidation.js';
import { TECH_SECTION_ID } from '../skills/techSegment.js';
import { guessSpeechSeconds } from '../media/voice.js';

// Agent 3 — Visual Director:
//   1) LLM plans each shot: source choice WITH reasoning + a rich shot spec
//   2) plan section refs are validated against the REAL script ids and repaired
//      deterministically (no silently fabricated or dropped sections)
//   3) the video-prompt skill builds model prompts; costModel estimates spend
//   4) if the plan exceeds the remaining budget, downgrade generated shots to
//      stock from the END until it fits (early shots carry the retention burden)
// Part of GATE B.

type PlanShot = ShotPlan['shots'][number];

const DEFAULT_SHOT_S = 4;
// Estimates price the runway rate — the video-generation agent's default model.
const EST_MODEL = 'runway' as const;
// The voice provider's shared words/2.3 pacing heuristic, floored to a usable shot length.
const speechSeconds = (text: string) => Math.max(DEFAULT_SHOT_S, guessSpeechSeconds(text));

// tech-slot backstop: whatever the plan (or a host-mode override) said, a real
// product never goes to a generative model — AI video cannot render a real product
// accurately, and a wrong product on a skeptical evidence-first show is a
// credibility wound. Prefer official press/b-roll via stock instead.
function forceTechToStock(shots: Shot[], ts: TechSegment | undefined): { shots: Shot[]; forced: number } {
  if (!ts?.enabled || ts.mode === 'explainer') return { shots, forced: 0 };
  let forced = 0;
  const out = shots.map((sh): Shot => {
    if (sh.section_id !== TECH_SECTION_ID || sh.source === 'stock' || sh.source === 'graphic' || sh.source === 'host') return sh;
    forced++;
    return { ...sh, source: 'stock', prompt: {}, cost_estimate_usd: 0 };
  });
  return { shots: out, forced };
}

export const visualDirector = defineAgent({
  name: 'visual_director',
  description: 'Plan one visual source + shot spec per script section with model prompts and cost estimates, fitted to the remaining budget.',
  skills: ['reference-validation', 'cost-model', 'tech-segment'],
  reads: ['script', 'channel', 'budget', 'tech_segment'],
  writes: ['shot_list'],
  requires: (s) => (s.script.sections.length === 0 ? 'no script sections to plan shots for' : null),

  async execute(ctx) {
    const sections = ctx.state.script.sections;
    const host = ctx.state.channel.host_mode;
    // Fixed tech slot: the visual problem FLIPS by mode. Explainer → generated shines
    // (concepts, generic hands-and-devices). Spotlight/hybrid → generated is banned for
    // the tech section (see forceTechToStock).
    const ts = ctx.state.tech_segment;

    // Avatar host mode = a real talking-head engine: every section is the host
    // (HeyGen avatar) narrating on camera. Fully deterministic, so the Opus plan
    // call (whose output the old code discarded entirely) is skipped outright.
    if (host === 'avatar') {
      let shots = sections.map((sec, i): Shot => {
        const duration_s = speechSeconds(sec.vo_text);
        return { shot_id: `sh${i + 1}`, section_id: sec.id, source: 'avatar', duration_s, prompt: {}, selected_asset: null, cost_estimate_usd: estimateAvatarCost(duration_s) };
      });
      // A spotlight/hybrid tech beat shows the real product, not the host talking.
      const techFix = forceTechToStock(shots, ts);
      shots = techFix.shots;
      if (techFix.forced) ctx.log.info('tech section forced to stock (real product; no generative render)', { forced: techFix.forced, product: ts?.product?.name ?? ts?.topic });
      const est = shots.reduce((n, x) => n + x.cost_estimate_usd, 0);
      if (est > ctx.budget_remaining_usd) ctx.log.warn('avatar plan exceeds remaining budget; avatar agent will budget-gate per clip', { est, remaining: ctx.budget_remaining_usd });
      ctx.log.info('avatar host mode: deterministic avatar shot list (LLM plan skipped)', { shots: shots.length, est });
      return { writes: { shot_list: shots }, cost_usd: 0, notes: `${shots.length} avatar shots, est $${est.toFixed(2)} (no LLM call)` };
    }

    const techGuide = ts?.enabled
      ? (ts.mode === 'explainer'
          ? `\nTech section ("${TECH_SECTION_ID}"): concept explainer — "generated" is a good fit (abstract/environmental, no real branded products).`
          : `\nTech section ("${TECH_SECTION_ID}"): real product (${ts.product?.name ?? ts.topic}) — NEVER "generated"; use "stock" (official press assets / b-roll) or "graphic".`)
      : '';

    const llm = getLLM();
    const plan = await llm.complete({
      tier: 'pro', temperature: 0.5, maxTokens: 2800, schema: ShotPlanSchema,   // Opus: richer, more precise gen prompts → better footage
      system: 'You are a Visual Director. For each section choose the best SOURCE (host/generated/stock/graphic/avatar) with a one-line reason, and write a concrete shot spec. Use "generated" only where it clearly adds value; prefer stock/graphic otherwise to control cost.',
      prompt: `Host mode: ${host}. Budget remaining: $${ctx.budget_remaining_usd.toFixed(2)}.${techGuide}\nSections:\n${sections.map((s) => `- ${s.id} [${s.beat}] vo="${s.vo_text.slice(0, 80)}" note="${s.shot_note}" onscreen="${s.on_screen}"`).join('\n')}\n\nReturn JSON {shots:[{section_id, source, reason, description, style, camera, motion(low|medium|high), mood, duration_s, negative[]}]}.`,
      mock: JSON.stringify({
        shots: sections.map((s, i) => ({
          section_id: s.id,
          source: i === 0 && host === 'mixed' ? 'avatar' : (i % 2 === 1 ? 'generated' : 'stock'),
          reason: i === 0 && host === 'mixed' ? 'host on camera via avatar for the intro' : (i % 2 === 1 ? 'a bespoke visual sells the key insight' : 'stock b-roll is sufficient and cheap'),
          description: s.shot_note || s.on_screen || s.vo_text.slice(0, 60),
          style: 'clean cinematic, high contrast', camera: i % 2 === 1 ? 'slow push in' : 'static wide',
          motion: 'medium', mood: 'neutral', duration_s: 4, negative: ['text', 'logos', 'watermark'],
        })),
      }),
    });

    // Repair the plan's section refs instead of trusting them: unknown/duplicate
    // ids are reassigned positionally to the first unshot section; sections the
    // plan skipped get an appended stock shot. Every section ends with ≥1 shot
    // and no shot carries an id that isn't in the script.
    const sectionIds = sections.map((sec) => sec.id);
    const report = validateRefs(sectionIds, plan.data!.shots.map((p) => p.section_id));
    const valid = new Set(sectionIds);
    const used = new Set<string>();
    const planned: { sp: PlanShot | null; section_id: string }[] = [];
    for (const sp of plan.data!.shots) {
      let id = valid.has(sp.section_id) && !used.has(sp.section_id) ? sp.section_id : sectionIds.find((x) => !used.has(x));
      // no unused section left: an extra shot on a real section is fine, a hallucinated id is not
      if (!id) { if (valid.has(sp.section_id)) id = sp.section_id; else continue; }
      used.add(id);
      planned.push({ sp, section_id: id });
    }
    for (const id of sectionIds) if (!used.has(id)) planned.push({ sp: null, section_id: id });
    if (!report.ok || report.duplicates.length) ctx.log.warn('repaired shot plan section refs', { unknown: report.unknown, duplicates: report.duplicates, unshot: report.unreferenced });

    // shot_list order IS timeline order downstream — keep it in script order
    const secIdx = new Map(sectionIds.map((id, i) => [id, i]));
    planned.sort((a, b) => secIdx.get(a.section_id)! - secIdx.get(b.section_id)!);

    let shots: Shot[] = planned.map(({ sp, section_id }, i): Shot => {
      const sec = sections[secIdx.get(section_id)!]!;
      if (!sp) {
        // filler for a section the plan skipped — cheap stock b-roll
        return { shot_id: `sh${i + 1}`, section_id, source: 'stock', duration_s: DEFAULT_SHOT_S, prompt: {}, selected_asset: null, cost_estimate_usd: 0 };
      }
      const duration_s = sp.duration_s ?? DEFAULT_SHOT_S;
      const isGen = sp.source === 'generated';
      const spec: ShotSpec = { description: sp.description || sec.shot_note || sec.vo_text.slice(0, 60), style: sp.style, camera: sp.camera, motion: sp.motion, mood: sp.mood, duration_s, negative: sp.negative };
      return {
        shot_id: `sh${i + 1}`, section_id,
        source: sp.source, duration_s,
        prompt: isGen ? videoPrompts(spec) : {},
        selected_asset: null,
        // avatar shots priced for real (HeyGen is credit-billed) — $0 estimates hid spend from the fit loop
        cost_estimate_usd: isGen ? estimateShotCost(duration_s, EST_MODEL) : sp.source === 'avatar' ? estimateAvatarCost(duration_s) : 0,
      };
    });

    // Voice-only host mode = cinematic b-roll engine: every section is AI-generated
    // footage (Runway), narrated by the voiceover track. No on-screen presenter.
    if (host === 'voice_only') {
      // Favor AI-video's strengths: wide/establishing, environmental, objects over people.
      // Push tight close-ups of faces/hands into the negative prompt (that's where artifacts show).
      const FRAMING_NEGATIVE = ['tight close-up', 'close-up face', 'close-up hands', 'distorted faces', 'distorted hands', 'deformed fingers'];
      shots = shots.map((s, i): Shot => {
        const sp = planned[i]!.sp;   // planned[] stays aligned with shots[] — no positional guessing against the raw plan
        const sec = sections[secIdx.get(s.section_id)!];
        const spec: ShotSpec = {
          description: `wide establishing shot, environmental: ${sp?.description || sec?.on_screen || sec?.vo_text.slice(0, 60) || 'cinematic b-roll'}`,
          style: sp?.style, camera: sp?.camera ?? 'gentle slow move', motion: sp?.motion ?? 'low', mood: sp?.mood,
          duration_s: s.duration_s, negative: [...(sp?.negative ?? []), ...FRAMING_NEGATIVE],
        };
        return { ...s, source: 'generated', prompt: videoPrompts(spec), cost_estimate_usd: estimateShotCost(s.duration_s, EST_MODEL) };
      });
      ctx.log.info('voice_only host mode: all shots set to generated b-roll (wide framing)', { shots: shots.length });
    }

    // tech-slot backstop runs last-but-one so it wins over the plan AND the
    // host-mode overrides above.
    const techFix = forceTechToStock(shots, ts);
    shots = techFix.shots;
    if (techFix.forced) ctx.log.info('tech section forced to stock (real product; no generative render)', { forced: techFix.forced, product: ts?.product?.name ?? ts?.topic });

    // cost-aware optimization: fit against what is left AFTER this call's own LLM
    // spend; downgrade generated→stock from the END (early shots drive retention)
    const budget = Math.max(0, ctx.budget_remaining_usd - plan.usage.costUsd);
    let est = shots.reduce((n, x) => n + x.cost_estimate_usd, 0);
    const flipped: string[] = [];
    for (let i = shots.length - 1; i >= 0 && est > budget; i--) {
      const shot = shots[i]!;
      if (shot.source !== 'generated') continue;
      est -= shot.cost_estimate_usd;
      shots[i] = { ...shot, source: 'stock', prompt: {}, cost_estimate_usd: 0 };
      flipped.push(shot.shot_id);
    }
    if (flipped.length) ctx.log.warn('downgraded generated shots to fit budget', { flipped, est });

    const genCount = shots.filter((x) => x.source === 'generated').length;
    return {
      writes: { shot_list: shots },
      cost_usd: plan.usage.costUsd,
      notes: `${shots.length} shots (${genCount} gen), est $${est.toFixed(2)}${flipped.length ? `, ${flipped.length} downgraded` : ''}${report.ok && !report.duplicates.length ? '' : `, refs repaired (${report.unknown.length} unknown, ${report.duplicates.length} dup, ${report.unreferenced.length} unshot)`}`,
    };
  },
});
