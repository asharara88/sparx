import 'dotenv/config';
import { getLLM } from '../src/llm/client.js';
import { getVoice } from '../src/media/voice.js';
import { getAvatar, resolveAvatarVoice } from '../src/media/avatar.js';
import { getVideo } from '../src/media/video.js';
import { renderEpisode, type RenderShot } from '../src/media/render.js';
import { getMusic } from '../src/media/music.js';
import { SCRIPT_SYSTEM, buildDemoPrompt, DemoScriptSchema, refineTopic } from '../src/skills/scriptPrompt.js';
import { mapLimit } from '../src/producer/concurrency.js';
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
// Sections render concurrently up to this cap. Default 2: HeyGen entry tiers allow
// only a few concurrent renders, and a quota 429 would fall through to a caption slate.
const CONC = Math.max(1, Math.min(4, parseInt(process.env.DEMO_CONCURRENCY || '2', 10) || 2));

// Demos fail fast to a caption slate rather than block on the full production HeyGen
// poll (.env typically sets 5 min). Cap at 2 min — or DEMO_HEYGEN_POLL_TIMEOUT_MS if set
// — but never longer than the configured value. Must run before any config() read.
const basePollMs = Number(process.env.HEYGEN_POLL_TIMEOUT_MS) || 300_000;
process.env.HEYGEN_POLL_TIMEOUT_MS = process.env.DEMO_HEYGEN_POLL_TIMEOUT_MS || String(Math.min(120_000, basePollMs));

(async () => {
  const llm = getLLM();
  const voice = getVoice();
  const voiceId = config().ELEVENLABS_VOICE_ID;

  // Refine the raw topic on the cheap/fast tier first, so the pro model writes from a
  // sharpened topic + angle instead of whatever bare phrase the user typed.
  console.log(`Refining topic (llm=${llm.live ? config().LLM_FAST_MODEL : 'mock'})...`);
  const brief = await refineTopic(llm, topic);
  if (brief.topic !== topic || brief.angle) {
    console.log(`  → refined topic: ${brief.topic}${brief.angle ? `\n  → angle: ${brief.angle}` : ''}`);
  }
  const refinedTopic = brief.topic;

  console.log(`Topic: ${refinedTopic}\nGenerating ${want}-section script (llm=${llm.live ? config().LLM_PRO_MODEL : 'mock'})...`);
  const draft = await llm.complete({
    tier: 'pro', temperature: 0.7, maxTokens: 3000, schema: DemoScriptSchema,
    system: SCRIPT_SYSTEM,
    prompt: buildDemoPrompt({ topic: refinedTopic, sections: want, angle: brief.angle }),
    mock: JSON.stringify({
      hook: `Here are the tools changing how we make ${refinedTopic}.`,
      sections: Array.from({ length: want }, (_, i) => ({
        vo_text: `Point ${i + 1}: this is sample narration about ${refinedTopic}. It moves the story forward with a concrete, specific detail.`,
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
    // Lip-sync source (AVATAR_VOICE): 'elevenlabs' narrates each section with your
    // ElevenLabs voice and HeyGen syncs the avatar's mouth to that uploaded audio;
    // 'heygen' uses HeyGen's built-in TTS. Only spend voice credits on a real avatar.
    const avatarVoice = avatar.live ? resolveAvatarVoice(c.AVATAR_VOICE, voice.live) : 'heygen';
    console.log(`Generating ${d.sections.length} avatar clips (provider=${avatar.name}, avatar=${c.HEYGEN_AVATAR_ID || '(default)'}, voice=${avatarVoice}, concurrency=${CONC})...`);
    // Sections render concurrently (mapLimit keeps result order); within a section,
    // voice-then-avatar stays serial because HeyGen lip-syncs to the uploaded audio.
    shots.push(...await mapLimit(d.sections, CONC, async (s, i) => {
      console.log(`  · section ${i + 1}/${d.sections.length} (HeyGen render can take a minute)...`);
      const fallbackDur = Math.max(3, Math.round(s.vo_text.split(/\s+/).length / 2.3));
      try {
        let audioUri: string | undefined;
        if (avatarVoice === 'elevenlabs') {
          try {
            audioUri = (await voice.synthesize(s.vo_text, voiceId)).uri;
          } catch (err) {
            console.warn(`  ⚠ section ${i + 1} ElevenLabs narration failed (${String(err).slice(0, 160)}); using HeyGen TTS`);
          }
        }
        const clip = await avatar.generate({ text: s.vo_text, avatarId: c.HEYGEN_AVATAR_ID, voiceId: c.HEYGEN_VOICE_ID, durationS: fallbackDur, audioUri });
        console.log(`  ✓ section ${i + 1}/${d.sections.length} done`);
        // Avatar video carries its own voice; the render keeps that audio.
        return { visual_uri: clip.uri, audio_uri: null, duration_s: clip.durationS ?? 6, caption: s.on_screen };
      } catch (err) {
        // Mirror the avatar agent: one HeyGen failure/timeout shouldn't sink the whole
        // demo — fall back to a captioned slate for this section so the render completes.
        console.warn(`  ⚠ section ${i + 1} HeyGen failed (${String(err).slice(0, 160)}); using caption slate`);
        console.log(`  ✓ section ${i + 1}/${d.sections.length} done`);
        return { visual_uri: null, audio_uri: null, duration_s: fallbackDur, caption: s.on_screen };
      }
    }));
  } else if (mode === 'broll') {
    // Cinematic b-roll: Runway generates the footage (text→image→video), the voice
    // provider narrates over it. Runway clips have no audio, so the narration is the
    // sole audio track (silent if no ELEVENLABS_API_KEY).
    const video = getVideo();
    console.log(`Generating ${d.sections.length} b-roll clips (provider=${video.name}) + voiceover (voice=${voice.name}, concurrency=${CONC})...`);
    shots.push(...await mapLimit(d.sections, CONC, async (s, i) => {
      const fallbackDur = Math.max(3, Math.round(s.vo_text.split(/\s+/).length / 2.3));
      console.log(`  · section ${i + 1}/${d.sections.length} (Runway render can take a minute)...`);
      // Steer away from AI-video's weak spots: wide/establishing, environmental, soft
      // focus — no tight close-ups of faces or hands (where artifacts show most).
      const prompt = `Cinematic wide establishing b-roll, environmental and atmospheric, soft natural light, gentle slow camera move, shallow depth of field on objects (not people). Avoid tight close-ups of faces or hands. No on-screen text. Scene: ${s.on_screen || s.vo_text.slice(0, 90)}`;
      // Narration and footage are independent — run both at once. Voice failure still
      // aborts the demo (as before); Runway failure falls back to a narrated slate.
      const [artR, takesR] = await Promise.allSettled([
        voice.synthesize(s.vo_text, voiceId),
        video.generate({ prompt, model: 'runway', durationS: 5 }),
      ]);
      if (artR.status === 'rejected') throw artR.reason;
      const art = artR.value;
      if (takesR.status === 'rejected') {
        console.warn(`  ⚠ section ${i + 1} Runway failed (${String(takesR.reason).slice(0, 160)}); using caption slate`);
        console.log(`  ✓ section ${i + 1}/${d.sections.length} done`);
        return { visual_uri: null, audio_uri: art.uri, duration_s: art.durationS ?? fallbackDur, caption: s.on_screen };
      }
      console.log(`  ✓ section ${i + 1}/${d.sections.length} done`);
      return { visual_uri: takesR.value[0]?.uri ?? null, audio_uri: art.uri, duration_s: art.durationS ?? fallbackDur, caption: s.on_screen };
    }));
  } else {
    console.log(`Voicing ${d.sections.length} sections (voice=${voice.name})...`);
    shots.push(...await mapLimit(d.sections, CONC, async (s, i) => {
      const art = await voice.synthesize(s.vo_text, voiceId);
      console.log(`  ✓ section ${i + 1}/${d.sections.length} done`);
      return { visual_uri: null, audio_uri: art.uri, duration_s: art.durationS ?? 5, caption: s.on_screen };
    }));
  }
  // Outro card with the CTA.
  shots.push({ visual_uri: null, audio_uri: null, duration_s: 3, caption: d.cta });

  // Optional background music bed. Off unless DEMO_MUSIC is truthy — keeps demo runs
  // cheap/fast by default. Render loops a short bed to fill the whole runtime.
  let musicUri: string | null = null;
  if (/^(1|true|on|yes)$/i.test(process.env.DEMO_MUSIC || '')) {
    const music = getMusic();
    const totalDur = shots.reduce((n, s) => n + (s.duration_s || 0), 0);
    const mood = brief.angle ? 'driving, hopeful, modern' : 'calm, cinematic, understated';
    console.log(`Generating background music (provider=${music.name}, mood=${mood})...`);
    if (!music.live) {
      console.log('  → music provider is in mock mode (no ELEVENLABS_API_KEY) — skipping real music.');
    } else {
      try {
        const track = await music.selectTrack(mood, totalDur);
        musicUri = track.uri;
        console.log(`  → music bed: ${track.uri}`);
      } catch (err) {
        console.warn(`  ⚠ music generation failed (${String(err).slice(0, 160)}); rendering without music`);
      }
    }
  }

  console.log('Rendering...');
  const r = await renderEpisode({ episodeId: 'demo', shots, musicUri });
  const spoken = mode === 'avatar' ? getAvatar().live : voice.live;
  console.log(`\n✅ Demo rendered: ${r.path}`);
  console.log(`   ${r.durationS}s · ${r.shots} shots · ${r.real} real footage · ${r.placeholders} placeholder · mode=${mode} · ${spoken ? 'spoken' : 'silent (provider in mock mode)'}`);
  if (mode === 'avatar' && r.real === 0) {
    console.log('   ⚠ avatar mode produced no real footage — check HEYGEN_API_KEY / HEYGEN_AVATAR_ID / HEYGEN_VOICE_ID.');
  }
})().catch((e) => { console.error('demo failed:', e); process.exit(1); });
