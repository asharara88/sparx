import type { Agent } from './types.js';
import { ok } from './types.js';
import type { Shot } from '../types/episode.js';
import { getLLM } from '../llm/client.js';
import { ShotPlanSchema } from '../schemas/phase1.js';
import { videoPrompts, type ShotSpec } from '../skills/videoPrompt.js';
import { estimateShotCost } from '../skills/cost.js';
import { createLogger } from '../logger.js';
import { AgentError } from '../errors.js';

// Agent 3 — Visual Director:
//   1) LLM plans each shot: source choice WITH reasoning + a rich shot spec
//   2) the video-prompt skill builds model prompts; the cost skill estimates spend
//   3) if the plan exceeds the remaining budget, downgrade the cheapest-value
//      generated shots to stock until it fits (cost-aware optimization)
// Part of GATE B.
export const visualDirector: Agent = {
  name: 'visual_director',
  async run(ctx) {
    const log = createLogger({ agent: 'visual_director', episode: ctx.episode_id });
    const sections = ctx.state.script.sections;
    if (sections.length === 0) throw new AgentError('visual_director', 'no script sections to plan shots for');
    const host = ctx.state.channel.host_mode;
    const llm = getLLM();

    const plan = await llm.complete({
      tier: 'pro', temperature: 0.5, maxTokens: 2800, schema: ShotPlanSchema,   // Opus: richer, more precise gen prompts → better footage
      system: 'You are a Visual Director. For each section choose the best SOURCE (host/generated/stock/graphic/avatar) with a one-line reason, and write a concrete shot spec. Use "generated" only where it clearly adds value; prefer stock/graphic otherwise to control cost.',
      prompt: `Host mode: ${host}. Budget remaining: $${ctx.budget_remaining_usd.toFixed(2)}.\nSections:\n${sections.map((s) => `- ${s.id} [${s.beat}] vo="${s.vo_text.slice(0, 80)}" note="${s.shot_note}" onscreen="${s.on_screen}"`).join('\n')}\n\nReturn JSON {shots:[{section_id, source, reason, description, style, camera, motion(low|medium|high), mood, duration_s, negative[]}]}.`,
      mock: JSON.stringify({
        shots: sections.map((s, i) => ({
          section_id: s.id,
          source: i === 0 && (host === 'avatar' || host === 'mixed') ? 'avatar' : (i % 2 === 1 ? 'generated' : 'stock'),
          reason: i === 0 && (host === 'avatar' || host === 'mixed') ? 'host on camera via avatar for the intro' : (i % 2 === 1 ? 'a bespoke visual sells the key insight' : 'stock b-roll is sufficient and cheap'),
          description: s.shot_note || s.on_screen || s.vo_text.slice(0, 60),
          style: 'clean cinematic, high contrast', camera: i % 2 === 1 ? 'slow push in' : 'static wide',
          motion: 'medium', mood: 'neutral', duration_s: 4, negative: ['text', 'logos', 'watermark'],
        })),
      }),
    });

    let shots: Shot[] = plan.data!.shots.map((sp, i): Shot => {
      const isGen = sp.source === 'generated';
      const spec: ShotSpec = { description: sp.description, style: sp.style, camera: sp.camera, motion: sp.motion, mood: sp.mood, duration_s: sp.duration_s ?? 4, negative: sp.negative };
      return {
        shot_id: `sh${i + 1}`, section_id: sp.section_id || sections[i]?.id || `s${i + 1}`,
        source: sp.source, duration_s: sp.duration_s ?? 4,
        prompt: isGen ? videoPrompts(spec) : {},
        selected_asset: null,
        cost_estimate_usd: isGen ? estimateShotCost(spec.duration_s ?? 4, 'runway') : 0,
      };
    });

    // Avatar host mode = a real talking-head video engine: every section is the host
    // (HeyGen avatar) narrating on camera. Forced deterministically so the full pipeline
    // produces a fully-narrated video even without a separate voiceover provider.
    if (host === 'avatar') {
      shots = shots.map((s) => ({ ...s, source: 'avatar', prompt: {}, cost_estimate_usd: 0 }));
      log.info('avatar host mode: all shots set to avatar narration', { shots: shots.length });
    }

    // Voice-only host mode = cinematic b-roll engine: every section is AI-generated
    // footage (Runway), narrated by the voiceover track. No on-screen presenter.
    if (host === 'voice_only') {
      // Favor AI-video's strengths: wide/establishing, environmental, objects over people.
      // Push tight close-ups of faces/hands into the negative prompt (that's where artifacts show).
      const FRAMING_NEGATIVE = ['tight close-up', 'close-up face', 'close-up hands', 'distorted faces', 'distorted hands', 'deformed fingers'];
      shots = shots.map((s, i): Shot => {
        const sp = plan.data!.shots[i];
        const spec: ShotSpec = {
          description: `wide establishing shot, environmental: ${sp?.description || sections[i]?.on_screen || sections[i]?.vo_text.slice(0, 60) || 'cinematic b-roll'}`,
          style: sp?.style, camera: sp?.camera ?? 'gentle slow move', motion: sp?.motion ?? 'low', mood: sp?.mood,
          duration_s: s.duration_s, negative: [...(sp?.negative ?? []), ...FRAMING_NEGATIVE],
        };
        return { ...s, source: 'generated', prompt: videoPrompts(spec), cost_estimate_usd: estimateShotCost(s.duration_s, 'runway') };
      });
      log.info('voice_only host mode: all shots set to generated b-roll (wide framing)', { shots: shots.length });
    }

    // cost-aware optimization: downgrade generated→stock until within budget
    const total = (s: Shot[]) => s.reduce((n, x) => n + x.cost_estimate_usd, 0);
    let downgraded = 0;
    while (total(shots) > ctx.budget_remaining_usd) {
      const idx = shots.findIndex((s) => s.source === 'generated');
      if (idx === -1) break;
      shots[idx] = { ...shots[idx]!, source: 'stock', prompt: {}, cost_estimate_usd: 0 };
      downgraded++;
    }
    if (downgraded) log.warn('downgraded generated shots to fit budget', { downgraded, est: total(shots) });

    const genCount = shots.filter((s) => s.source === 'generated').length;
    return ok(ctx, { shot_list: shots }, plan.usage.costUsd,
      `${shots.length} shots (${genCount} gen), est $${total(shots).toFixed(2)}${downgraded ? `, ${downgraded} downgraded` : ''}`);
  },
};
