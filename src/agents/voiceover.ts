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
    let cost = 0;
    for (const s of ctx.state.script.sections) {
      const art = await voice.synthesize(s.vo_text, voiceId);
      clips.push({ section_id: s.id, audio_uri: art.uri, duration_s: art.durationS ?? 0 });
      cost += art.costUsd;
    }
    const total = clips.reduce((n, c) => n + c.duration_s, 0);
    log.info('voiceover synthesized', { clips: clips.length, total, provider: voice.name });
    return ok(ctx, { voiceover: { voice_id: voiceId, clips, total_duration_s: total } }, cost, `${clips.length} clips, ${total}s (${voice.name})`);
  },
};
