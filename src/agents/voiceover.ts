import { defineAgent } from './core.js';
import { getVoice, guessSpeechSeconds } from '../media/voice.js';
import { config } from '../config.js';
import { settleLimit } from '../util/concurrency.js';
import { cachedArtifact, contentKey } from '../skills/artifactCache.js';
import { estimateVoiceCost, shouldThrottle } from '../skills/costModel.js';
import type { MediaArtifact } from '../media/types.js';

// Agent 4 — Voiceover. Synthesizes narration per section via the voice provider
// (ElevenLabs when keyed, mock otherwise). Sections are independent, so they run
// in parallel (bounded by MEDIA_CONCURRENCY) and every synthesis is content-cached
// — a Producer retry of 'generating' never re-bills already-produced narration.

export const voiceover = defineAgent({
  name: 'voiceover',
  description: 'Synthesize per-section narration audio (parallel, content-cached) and record clip durations + cost.',
  skills: ['artifact-cache', 'cost-model'],
  reads: ['script', 'voiceover', 'channel'],
  writes: ['voiceover'],
  requires: (s) => (s.script.sections.length === 0 ? 'no script sections to narrate' : null),

  async execute(ctx) {
    const voice = getVoice();
    const voiceId = ctx.state.voiceover.voice_id || config().ELEVENLABS_VOICE_ID;
    const sections = ctx.state.script.sections;

    // Estimate before spending; only gate live spend — the mock path is free.
    const estimate = estimateVoiceCost(sections.reduce((n, s) => n + s.vo_text.length, 0));
    if (voice.live && shouldThrottle(ctx.state, estimate)) {
      return { writes: {}, status: 'needs_human', notes: `estimated voice cost $${estimate.toFixed(2)} would exceed the budget cap` };
    }
    // Known duplicate-spend: in 'avatar' host mode HeyGen renders the same narration
    // with its own voice track — flag it so the money isn't burned silently.
    if (voice.live && ctx.state.channel.host_mode === 'avatar') ctx.log.warn('host_mode=avatar also carries voice — narration is being paid for twice', { estimate });

    const settled = await settleLimit(sections, config().MEDIA_CONCURRENCY, async (s) => {
      const made: { art?: MediaArtifact } = {}; // set on cache miss only
      const art = await cachedArtifact(contentKey('voice', voiceId, s.vo_text), async () => {
        made.art = await voice.synthesize(s.vo_text, voiceId);
        return { uri: made.art.uri, costUsd: made.art.costUsd };
      });
      // Cache hits carry uri+cost only — fall back to the speaking-rate guess
      // (same formula as the mock provider) instead of re-probing here.
      return { clip: { section_id: s.id, audio_uri: art.uri, duration_s: made.art?.durationS || guessSpeechSeconds(s.vo_text) }, costUsd: art.costUsd };
    });
    for (const f of settled.failed) ctx.log.warn('voiceover failed for section; leaving silent', { section: f.item.id, err: String(f.error).slice(0, 160) });

    // settleLimit restores input order — clips stay in section order regardless of completion order.
    const clips = settled.ok.map((o) => o.value.clip);
    const cost = settled.ok.reduce((n, o) => n + o.value.costUsd, 0);
    const total = clips.reduce((n, c) => n + c.duration_s, 0);
    const skipped = settled.failed.map((f) => f.item.id);
    const writes = { voiceover: { voice_id: voiceId, clips, total_duration_s: total } };

    // A few failures degrade to silent captioned slates; a mostly-silent episode
    // must not ship without a human look. Successful clips are still written so a
    // rerun only re-pays (or cache-hits) the failed sections.
    if (skipped.length * 2 > sections.length) {
      return { writes, cost_usd: cost, status: 'needs_human', notes: `voiceover failed for ${skipped.length}/${sections.length} sections (${skipped.join(', ')}) — episode would be mostly silent (${voice.name})` };
    }
    ctx.log.info('voiceover synthesized', { clips: clips.length, skipped: skipped.length, total, provider: voice.name });
    return { writes, cost_usd: cost, notes: `${clips.length} clips, ${total}s${skipped.length ? `, skipped: ${skipped.join(', ')}` : ''} (${voice.name})` };
  },
});
