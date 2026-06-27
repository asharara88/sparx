import type { Agent } from './types.js';
import { ok } from './types.js';
import type { AvatarClip } from '../types/episode.js';
import { getAvatar } from '../media/avatar.js';
import { config } from '../config.js';
import { canAfford } from '../producer/budget.js';
import { createLogger } from '../logger.js';

// Agent 3b — Avatar (HeyGen). Renders an avatar speaking the section narration for
// each shot whose source is "avatar" (intros, cutaways, explainers, dubs — handoff §5).
// Writes the disjoint `avatar_clips` field so it runs in parallel with video/asset agents.
export const avatar: Agent = {
  name: 'avatar',
  async run(ctx) {
    const log = createLogger({ agent: 'avatar', episode: ctx.episode_id });
    const provider = getAvatar();
    const c = config();
    const avatarId = ctx.state.channel.host_mode === 'avatar' || ctx.state.channel.host_mode === 'mixed'
      ? c.HEYGEN_AVATAR_ID : c.HEYGEN_AVATAR_ID;
    const secById = new Map(ctx.state.script.sections.map((s) => [s.id, s]));
    const avatarShots = ctx.state.shot_list.filter((s) => s.source === 'avatar');

    const clips: AvatarClip[] = [];
    let cost = 0; let skipped = 0;
    for (const shot of avatarShots) {
      const text = secById.get(shot.section_id)?.vo_text ?? '';
      if (!text) { skipped++; continue; }
      const est = Math.max(0.02, shot.duration_s * 0.005);
      if (!canAfford(ctx.state, cost + est)) { skipped++; continue; }
      try {
        const art = await provider.generate({ text, avatarId, voiceId: c.HEYGEN_VOICE_ID, durationS: shot.duration_s });
        cost += art.costUsd;
        clips.push({ shot_id: shot.shot_id, avatar_id: avatarId || 'default', video_uri: art.uri, duration_s: art.durationS ?? shot.duration_s, cost_usd: art.costUsd });
      } catch (err) {
        log.warn('avatar generation failed; leaving for stock fallback', { shot: shot.shot_id, err: String(err) });
        skipped++;
      }
    }
    log.info('avatar clips rendered', { clips: clips.length, skipped, provider: provider.name });
    return ok(ctx, { avatar_clips: clips }, cost, `${clips.length} avatar clips${skipped ? `, ${skipped} skipped` : ''} (${provider.name})`);
  },
};
