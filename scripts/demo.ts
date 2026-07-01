import 'dotenv/config';
import { getLLM } from '../src/llm/client.js';
import { getVoice } from '../src/media/voice.js';
import { getAvatar } from '../src/media/avatar.js';
import { getVideo } from '../src/media/video.js';
import { renderEpisode, type RenderShot } from '../src/media/render.js';
import { SCRIPT_SYSTEM, buildDemoPrompt, DemoScriptSchema } from '../src/skills/scriptPrompt.js';
import { config } from '../src/config.js';

// Quick demo renderer: write a short script with the LLM, then either
//   - 'avatar' mode (default when HEYGEN_API_KEY is set): your HeyGen avatar speaks each
//     section on camera, OR
//   - 'voiceover' mode: ElevenLabs (or silent mock) narration over caption slates,
// and render one captioned mp4.
//   npm run demo:video -- "Your topic here"
//   DEMO_SECTIONS=3 DEMO_MODE=avatar|voiceover npm run demo:video
const topic = process.argv.slice(2).join(' ') || '5 newborn-care mistakes new parents make — and the old advice doctors now warn against';
const want = Math.max(1, Math.min(6, parseInt(process.env.DEMO_SECTIONS || '5', 10)));

// Demos fail fast to a caption slate rather than block on the full production HeyGen
// poll (.env typically sets 5 min). Cap at 2 min — or DEMO_HEYGEN_POLL_TIMEOUT_MS if set
// — but never longer than the configured value. Must run before any config() read.
const basePollMs = Number(process.env.HEYGEN_POLL_TIMEOUT_MS) || 300_000;
process.env.HEYGEN_POLL_TIMEOUT_MS = process.env.DEMO_HEYGEN_POLL_TIMEOUT_MS || String(Math.min(120_000, basePollMs));

(async () => {
  const llm = getLLM();
  const voice = getVoice();
  const voiceId = config().ELEVENLABS_VOICE_ID;

  console.log(`Topic: ${topic}\nGenerating ${want}-section script (llm=${llm.live ? config().LLM_PRO_MODEL : 'mock'})...`);
  const draft = await llm.complete({
    tier: 'pro', temperature: 0.7, maxTokens: 3000, schema: DemoScriptSchema,
    system: SCRIPT_SYSTEM,
    prompt: buildDemoPrompt({ topic, sections: want }),
    mock: JSON.stringify({
      hook: `Here are the tools changing how we make ${topic}.`,
      sections: Array.from({ length: want }, (_, i) => ({
        vo_text: `Point ${i + 1}: this is sample narration about ${topic}. It moves the story forward with a concrete, specific detail.`,
        on_screen: `Point ${i + 1}`,
      })),
      cta: 'Subscribe for a new deep dive every week.',
    }),
  });
  const d = draft.data!;
  const c = config();

  const mode = (process.env.DEMO_MODE || (c.HEYGEN_API_KEY ? 'avatar' : 'voiceover')).toLowerCase();
  const shots: RenderShot[] = [];
  // Intro card with the hook.
  shots.push({ visual_uri: null, audio_uri: null, duration_s: 3, caption: d.hook });

  if (mode === 'avatar') {
    const avatar = getAvatar();
    console.log(`Generating ${d.sections.length} avatar clips (provider=${avatar.name}, avatar=${c.HEYGEN_AVATAR_ID || '(default)'})...`);
    for (const [i, s] of d.sections.entries()) {
      console.log(`  · section ${i + 1}/${d.sections.length} (HeyGen render can take a minute)...`);
      const fallbackDur = Math.max(3, Math.round(s.vo_text.split(/\s+/).length / 2.3));
      try {
        const clip = await avatar.generate({ text: s.vo_text, avatarId: c.HEYGEN_AVATAR_ID, voiceId: c.HEYGEN_VOICE_ID, durationS: fallbackDur });
        // Avatar video carries its own voice; the render keeps that audio.
        shots.push({ visual_uri: clip.uri, audio_uri: null, duration_s: clip.durationS ?? 6, caption: s.on_screen });
      } catch (err) {
        // Mirror the avatar agent: one HeyGen failure/timeout shouldn't sink the whole
        // demo — fall back to a captioned slate for this section so the render completes.
        console.warn(`  ⚠ section ${i + 1} HeyGen failed (${String(err).slice(0, 160)}); using caption slate`);
        shots.push({ visual_uri: null, audio_uri: null, duration_s: fallbackDur, caption: s.on_screen });
      }
    }
  } else if (mode === 'broll') {
    // Cinematic b-roll: Runway generates the footage (text→image→video), the voice
    // provider narrates over it. Runway clips have no audio, so the narration is the
    // sole audio track (silent if no ELEVENLABS_API_KEY).
    const video = getVideo();
    console.log(`Generating ${d.sections.length} b-roll clips (provider=${video.name}) + voiceover (voice=${voice.name})...`);
    for (const [i, s] of d.sections.entries()) {
      const fallbackDur = Math.max(3, Math.round(s.vo_text.split(/\s+/).length / 2.3));
      const art = await voice.synthesize(s.vo_text, voiceId);
      try {
        console.log(`  · section ${i + 1}/${d.sections.length} (Runway render can take a minute)...`);
        // Steer away from AI-video's weak spots: wide/establishing, environmental, soft
        // focus — no tight close-ups of faces or hands (where artifacts show most).
        const prompt = `Cinematic wide establishing b-roll, environmental and atmospheric, soft natural light, gentle slow camera move, shallow depth of field on objects (not people). Avoid tight close-ups of faces or hands. No on-screen text. Scene: ${s.on_screen || s.vo_text.slice(0, 90)}`;
        const takes = await video.generate({ prompt, model: 'runway', durationS: 5 });
        shots.push({ visual_uri: takes[0]?.uri ?? null, audio_uri: art.uri, duration_s: art.durationS ?? fallbackDur, caption: s.on_screen });
      } catch (err) {
        console.warn(`  ⚠ section ${i + 1} Runway failed (${String(err).slice(0, 160)}); using caption slate`);
        shots.push({ visual_uri: null, audio_uri: art.uri, duration_s: art.durationS ?? fallbackDur, caption: s.on_screen });
      }
    }
  } else {
    console.log(`Voicing ${d.sections.length} sections (voice=${voice.name})...`);
    for (const s of d.sections) {
      const art = await voice.synthesize(s.vo_text, voiceId);
      shots.push({ visual_uri: null, audio_uri: art.uri, duration_s: art.durationS ?? 5, caption: s.on_screen });
    }
  }
  // Outro card with the CTA.
  shots.push({ visual_uri: null, audio_uri: null, duration_s: 3, caption: d.cta });

  console.log('Rendering...');
  const r = await renderEpisode({ episodeId: 'demo', shots, musicUri: null });
  const spoken = mode === 'avatar' ? getAvatar().live : voice.live;
  console.log(`\n✅ Demo rendered: ${r.path}`);
  console.log(`   ${r.durationS}s · ${r.shots} shots · ${r.real} real footage · ${r.placeholders} placeholder · mode=${mode} · ${spoken ? 'spoken' : 'silent (provider in mock mode)'}`);
  if (mode === 'avatar' && r.real === 0) {
    console.log('   ⚠ avatar mode produced no real footage — check HEYGEN_API_KEY / HEYGEN_AVATAR_ID / HEYGEN_VOICE_ID.');
  }
})().catch((e) => { console.error('demo failed:', e); process.exit(1); });
