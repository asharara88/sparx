import { defineAgent } from './core.js';
import type { AvatarClip } from '../types/episode.js';
import { getAvatar, resolveAvatarVoice } from '../media/avatar.js';
import { getVoice } from '../media/voice.js';
import { settleLimit } from '../util/concurrency.js';
import { cachedArtifact, contentKey } from '../skills/artifactCache.js';
import { estimateAvatarCost, shouldThrottle } from '../skills/costModel.js';
import { config } from '../config.js';

// Agent 3b — Avatar (HeyGen). Renders an avatar speaking the section narration for
// each shot whose source is "avatar" (intros, cutaways, explainers, dubs — handoff §5).
// Clips render IN PARALLEL (each is a multi-minute HeyGen poll), budget-gated with
// pessimistic reservation, and content-cached so retries never re-bill identical
// (avatar, voice, text) inputs. Lip-sync source (AVATAR_VOICE): with a live
// ElevenLabs voice, each clip's narration is synthesized there and uploaded so
// HeyGen syncs the mouth to YOUR voice; otherwise HeyGen's TTS speaks the text.
// Writes the disjoint `avatar_clips` field so it runs in parallel with the
// video/asset agents.

export const avatar = defineAgent({
  name: 'avatar',
  description: 'Render HeyGen talking-head clips for avatar shots in parallel, budget-gated and content-cached.',
  skills: ['artifact-cache', 'cost-model'],
  reads: ['shot_list', 'script', 'channel', 'voiceover'],
  writes: ['avatar_clips'],

  async execute(ctx) {
    const provider = getAvatar();
    const voice = getVoice();
    const c = config();
    const avatarId = c.HEYGEN_AVATAR_ID;
    // Only spend ElevenLabs credits when the avatar provider is real.
    const voiceMode = provider.live ? resolveAvatarVoice(c.AVATAR_VOICE, voice.live) : 'heygen';
    if (provider.live && c.AVATAR_VOICE === 'elevenlabs' && voiceMode === 'heygen')
      ctx.log.warn('AVATAR_VOICE=elevenlabs but the voice provider is mock (no ELEVENLABS_API_KEY); using HeyGen TTS');
    const elevenVoiceId = ctx.state.voiceover.voice_id || c.ELEVENLABS_VOICE_ID;
    // The lip-sync source is part of the artifact identity — switching AVATAR_VOICE
    // must not serve a clip narrated by the other voice from the cache.
    const voiceKey = voiceMode === 'elevenlabs' ? `elevenlabs:${elevenVoiceId}` : c.HEYGEN_VOICE_ID;
    const secById = new Map(ctx.state.script.sections.map((s) => [s.id, s]));
    const voBySection = new Map(ctx.state.voiceover.clips.map((v) => [v.section_id, v]));
    const shots = ctx.state.shot_list.filter((s) => s.source === 'avatar');

    if (shots.length && (ctx.state.channel.host_mode === 'real_face' || ctx.state.channel.host_mode === 'voice_only'))
      ctx.log.warn('avatar shots present but host_mode has no avatar', { host_mode: ctx.state.channel.host_mode, shots: shots.length });
    // Live provider with an empty avatar id would 400 every shot and silently ship
    // zero clips — escalate instead of degrading.
    if (shots.length && provider.live && !avatarId)
      return { writes: { avatar_clips: [] }, status: 'needs_human' as const, notes: 'HEYGEN_API_KEY is set but HEYGEN_AVATAR_ID is empty — cannot render avatar shots' };

    // The section's VO clip speaks the same text HeyGen will — its measured duration
    // is a better cost basis than the planned shot duration.
    const spokenS = (sectionId: string, fallback: number) => voBySection.get(sectionId)?.duration_s ?? fallback;

    let reserved = 0;
    const throttled: string[] = []; const noText: string[] = [];
    const dispatch = shots.filter((shot) => {
      if (!secById.get(shot.section_id)?.vo_text) { noText.push(shot.shot_id); return false; }
      // Only gate live spend — mock shots cost $0 and must never be skipped
      // under a small cap (same live-only gating as voiceover/music).
      if (provider.live) {
        const est = estimateAvatarCost(spokenS(shot.section_id, shot.duration_s));
        if (shouldThrottle(ctx.state, reserved + est)) { throttled.push(shot.shot_id); return false; }
        reserved += est;
      }
      return true;
    });

    const { ok: made, failed } = await settleLimit(dispatch, c.MEDIA_CONCURRENCY, async (shot): Promise<AvatarClip> => {
      const text = secById.get(shot.section_id)!.vo_text;
      let durationS = spokenS(shot.section_id, shot.duration_s);
      const art = await cachedArtifact(contentKey('avatar', avatarId, voiceKey, text), async () => {
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
            ctx.log.warn('elevenlabs narration failed; falling back to HeyGen TTS for this clip', { shot: shot.shot_id, err: String(err).slice(0, 160) });
          }
        }
        const a = await provider.generate({ text, avatarId, voiceId: c.HEYGEN_VOICE_ID, durationS: shot.duration_s, audioUri });
        durationS = a.durationS ?? durationS;
        return { uri: a.uri, costUsd: a.costUsd + voiceCost };
      });
      return { shot_id: shot.shot_id, avatar_id: avatarId || 'default', video_uri: art.uri, duration_s: durationS, cost_usd: art.costUsd };
    });

    for (const f of failed) ctx.log.warn('avatar generation failed; editor placeholder covers the gap', { shot: f.item.shot_id, err: String(f.error).slice(0, 200) });
    const clips = made.map((m) => m.value);
    const cost = clips.reduce((n, cl) => n + cl.cost_usd, 0);
    ctx.log.info('avatar clips rendered', { clips: clips.length, throttled: throttled.length, noText: noText.length, failed: failed.length, provider: provider.name, voice: voiceMode });

    const bits = [`${clips.length} avatar clips`];
    if (throttled.length) bits.push(`${throttled.length} skipped over budget: ${throttled.join(', ')}`);
    if (noText.length) bits.push(`${noText.length} without narration: ${noText.join(', ')}`);
    if (failed.length) bits.push(`${failed.length} failed: ${failed.map((f) => f.item.shot_id).join(', ')}`);
    return { writes: { avatar_clips: clips }, cost_usd: cost, notes: `${bits.join('; ')} (${provider.name}, voice=${voiceMode})` };
  },
});
