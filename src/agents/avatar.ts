import type { Agent } from './types.js';
import { ok } from './types.js';
import type { AvatarClip } from '../types/episode.js';
import { getAvatar, resolveAvatarVoice } from '../media/avatar.js';
import { getVoice } from '../media/voice.js';
import { config } from '../config.js';
import { canAfford } from '../producer/budget.js';
import { createLogger } from '../logger.js';

// Agent 3b — Avatar (HeyGen). Renders an avatar speaking the section narration for
// each shot whose source is "avatar" (intros, cutaways, explainers, dubs — handoff §5).
// Lip-sync source (AVATAR_VOICE): with a live ElevenLabs voice, each clip's narration
// is synthesized there and uploaded so HeyGen syncs the mouth to YOUR voice; otherwise
// HeyGen's TTS speaks the text. Writes the disjoint `avatar_clips` field so it runs
// in parallel with video/asset agents.
export const avatar: Agent = {
  name: 'avatar',
  async run(ctx) {
    const log = createLogger({ agent: 'avatar', episode: ctx.episode_id });
    const provider = getAvatar();
    const voice = getVoice();
    const c = config();
    // Only spend ElevenLabs credits when the avatar provider is real.
    const voiceMode = provider.live ? resolveAvatarVoice(c.AVATAR_VOICE, voice.live) : 'heygen';
    if (provider.live && c.AVATAR_VOICE === 'elevenlabs' && voiceMode === 'heygen') {
      log.warn('AVATAR_VOICE=elevenlabs but the voice provider is mock (no ELEVENLABS_API_KEY); using HeyGen TTS');
    }
    const elevenVoiceId = ctx.state.voiceover.voice_id || c.ELEVENLABS_VOICE_ID;
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
        let audioUri: string | undefined;
        let voiceCost = 0;
        if (voiceMode === 'elevenlabs') {
          try {
            const audio = await voice.synthesize(text, elevenVoiceId);
            audioUri = audio.uri;
            voiceCost = audio.costUsd;
          } catch (err) {
            // Narration failure shouldn't sink the clip — HeyGen TTS still produces
            // a fully lip-synced avatar, just not in the cloned voice.
            log.warn('elevenlabs narration failed; falling back to HeyGen TTS for this clip', { shot: shot.shot_id, err: String(err).slice(0, 160) });
          }
        }
        const art = await provider.generate({ text, avatarId, voiceId: c.HEYGEN_VOICE_ID, durationS: shot.duration_s, audioUri });
        cost += art.costUsd + voiceCost;
        clips.push({ shot_id: shot.shot_id, avatar_id: avatarId || 'default', video_uri: art.uri, duration_s: art.durationS ?? shot.duration_s, cost_usd: art.costUsd + voiceCost });
      } catch (err) {
        log.warn('avatar generation failed; leaving for stock fallback', { shot: shot.shot_id, err: String(err) });
        skipped++;
      }
    }
    log.info('avatar clips rendered', { clips: clips.length, skipped, provider: provider.name, voice: voiceMode });
    return ok(ctx, { avatar_clips: clips }, cost, `${clips.length} avatar clips${skipped ? `, ${skipped} skipped` : ''} (${provider.name}, voice=${voiceMode})`);
  },
};
