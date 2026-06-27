import type { Agent } from './types.js';
import { ok } from './types.js';
import { getMusic } from '../media/music.js';
import { createLogger } from '../logger.js';

// Agent 8 — Music & SFX. Selects a track sized to the runtime + a couple of SFX,
// beat-synced to voiceover duration. (blockedBy voiceover in the state machine.)
export const music: Agent = {
  name: 'music',
  async run(ctx) {
    const log = createLogger({ agent: 'music', episode: ctx.episode_id });
    const provider = getMusic();
    const dur = ctx.state.voiceover.total_duration_s || (ctx.state.concept.target_length_min * 60);
    const mood = ctx.state.concept.angle_candidates[0]?.angle ? 'driving' : 'neutral';

    const track = await provider.selectTrack(mood, dur);
    const sfx = await Promise.all(['whoosh', 'pop'].map((n) => provider.sfx(n)));
    const cost = track.costUsd + sfx.reduce((n, s) => n + s.costUsd, 0);
    log.info('music selected', { dur, provider: provider.name });
    return ok(ctx, { music: { track_uri: track.uri, sfx: sfx.map((s) => s.uri), license: track.license ?? 'unknown', cost_usd: cost } }, cost, `track + ${sfx.length} sfx, ${dur}s (${provider.name})`);
  },
};
