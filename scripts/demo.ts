import 'dotenv/config';
import { z } from 'zod';
import { getLLM } from '../src/llm/client.js';
import { getVoice } from '../src/media/voice.js';
import { getAvatar } from '../src/media/avatar.js';
import { renderEpisode, type RenderShot } from '../src/media/render.js';
import { config } from '../src/config.js';

// Quick demo renderer: write a short script with the LLM, then either
//   - 'avatar' mode (default when HEYGEN_API_KEY is set): your HeyGen avatar speaks each
//     section on camera, OR
//   - 'voiceover' mode: ElevenLabs (or silent mock) narration over caption slates,
// and render one captioned mp4.
//   npm run demo:video -- "Your topic here"
//   DEMO_SECTIONS=3 DEMO_MODE=avatar|voiceover npm run demo:video
const topic = process.argv.slice(2).join(' ') || 'Three AI tools that save video creators hours every week';
const want = Math.max(1, Math.min(6, parseInt(process.env.DEMO_SECTIONS || '3', 10)));

// Small, demo-only schema (the production ScriptDraftSchema requires >=4 sections).
const DemoScript = z.object({
  hook: z.string().min(8),
  sections: z.array(z.object({
    vo_text: z.string().min(1),
    on_screen: z.string().min(1),
  })).min(1).max(6),
  cta: z.string().min(1),
});

(async () => {
  const llm = getLLM();
  const voice = getVoice();
  const voiceId = config().ELEVENLABS_VOICE_ID;

  console.log(`Topic: ${topic}\nGenerating ${want}-section script (llm=${llm.live ? config().LLM_MODEL : 'mock'})...`);
  const draft = await llm.complete({
    tier: 'main', temperature: 0.7, maxTokens: 3000, schema: DemoScript,
    system: 'You write punchy, spoken-voice YouTube narration. Each section is 2-3 sentences.',
    prompt: `Topic: ${topic}\n\nReturn ONLY JSON {"hook": string, "sections": [exactly ${want} objects {"vo_text": 2-3 spoken sentences, "on_screen": a short caption}], "cta": string}.`,
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
      const clip = await avatar.generate({ text: s.vo_text, avatarId: c.HEYGEN_AVATAR_ID, voiceId: c.HEYGEN_VOICE_ID, durationS: Math.round(s.vo_text.split(/\s+/).length / 2.3) });
      // Avatar video carries its own voice; the render keeps that audio.
      shots.push({ visual_uri: clip.uri, audio_uri: null, duration_s: clip.durationS ?? 6, caption: s.on_screen });
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
  console.log(`   ${r.durationS}s · ${r.shots} shots · mode=${mode} · ${spoken ? 'spoken' : 'silent (provider in mock mode)'}`);
})().catch((e) => { console.error('demo failed:', e); process.exit(1); });
