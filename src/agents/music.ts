import { defineAgent } from './core.js';
import { getMusic } from '../media/music.js';
import { cachedArtifact, contentKey } from '../skills/artifactCache.js';
import { PRICES, shouldThrottle } from '../skills/costModel.js';
import type { MediaArtifact } from '../media/types.js';

// Agent 8 — Music & SFX. Composes/selects a background bed sized to the measured
// voiceover runtime plus a couple of SFX. (blockedBy voiceover in the state
// machine — the bed length comes from voiceover.total_duration_s, and a missing
// duration means voiceover failed upstream, so we surface that instead of guessing.)

const MOOD = 'neutral'; // fixed bed style until a real tone signal exists (the old angle-based branch always chose 'driving')
const SFX_NAMES = ['whoosh', 'pop'];

export const music = defineAgent({
  name: 'music',
  description: 'Select or compose a background music bed sized to the voiceover runtime, plus SFX; cached per duration+style.',
  skills: ['artifact-cache', 'cost-model'],
  reads: ['voiceover', 'music'],
  writes: ['music'],
  requires: (s) => (s.voiceover.total_duration_s > 0 ? null : 'no voiceover duration to size the music bed'),

  async execute(ctx) {
    const provider = getMusic();
    const dur = ctx.state.voiceover.total_duration_s;
    if (ctx.state.music.track_uri) ctx.log.debug('replacing existing music selection', { prev: ctx.state.music.track_uri });

    // Estimate before spending; only gate live spend — the mock path is free.
    if (provider.live && shouldThrottle(ctx.state, PRICES.music_flat)) {
      return { writes: {}, status: 'needs_human', notes: `estimated music cost $${PRICES.music_flat.toFixed(2)} would exceed the budget cap` };
    }

    // Track composition and SFX are independent; the bed is cached on duration+style
    // so a rerun of 'generating' reuses the exact same artifact at cost 0.
    const made: { art?: MediaArtifact } = {}; // set on cache miss only
    const [track, sfx] = await Promise.all([
      cachedArtifact(contentKey('music', MOOD, dur), async () => {
        made.art = await provider.selectTrack(MOOD, dur);
        // durationS rides along into the cache so hits keep the measured bed length
        return { uri: made.art.uri, costUsd: made.art.costUsd, durationS: made.art.durationS };
      }),
      Promise.all(SFX_NAMES.map((n) => provider.sfx(n))),
    ]);

    // Cache hits carry uri+cost only — reconstruct the license from the provider tier.
    const license = made.art?.license ?? (provider.live ? 'elevenlabs-music' : 'mock');
    const cost = track.costUsd + sfx.reduce((n, s) => n + s.costUsd, 0);
    ctx.log.info('music selected', { dur, cached: track.cached, provider: provider.name });
    return {
      writes: { music: { track_uri: track.uri, sfx: sfx.map((s) => s.uri), license, cost_usd: cost } },
      cost_usd: cost,
      notes: `track${track.cached ? ' (cached)' : ''} + ${sfx.length} sfx, ${dur}s (${provider.name})`,
    };
  },
});
