import type { Agent } from './types.js';
import { ok } from './types.js';
import { getVoice } from '../media/voice.js';
import { config } from '../config.js';
import { createLogger } from '../logger.js';

// Agent 4 — Voiceover. Synthesizes narration per section via the voice provider
// (ElevenLabs when keyed, mock otherwise). Records duration + cost.
export const voiceover: Agent = {
  name: 'voiceover',
  async run(ctx) {
    const log = createLogger({ agent: 'voiceover', episode: ctx.episode_id });
    const voice = getVoice();
    const voiceId = ctx.state.voiceover.voice_id || config().ELEVENLABS_VOICE_ID;

    const clips = [];
    let cost = 0; let skipped = 0;
    for (const s of ctx.state.script.sections) {
      try {
        const art = await voice.synthesize(s.vo_text, voiceId);
        clips.push({ section_id: s.id, audio_uri: art.uri, duration_s: art.durationS ?? 0 });
        cost += art.costUsd;
      } catch (err) {
        // A voice failure (bad voice id, rate limit, outage) shouldn't sink the whole
        // episode after research+script are paid for. Skip this section's narration —
        // the render falls back to a silent captioned slate — and flag it.
        log.warn('voiceover failed for section; leaving silent', { section: s.id, err: String(err).slice(0, 160) });
        skipped++;
      }
    }
    const total = clips.reduce((n, c) => n + c.duration_s, 0);
    log.info('voiceover synthesized', { clips: clips.length, skipped, total, provider: voice.name });
    return ok(ctx, { voiceover: { voice_id: voiceId, clips, total_duration_s: total } }, cost, `${clips.length} clips, ${total}s${skipped ? `, ${skipped} skipped` : ''} (${voice.name})`);
  },
};
