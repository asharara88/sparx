import 'dotenv/config';
import type { ZodType } from 'zod';
import { getLLM } from '../src/llm/client.js';
import { SCRIPT_SYSTEM, buildDemoPrompt, pickLens } from '../src/skills/scriptPrompt.js';
import { IdeationSchema } from '../src/schemas/phase1.js';
import { PackagingSchema } from '../src/schemas/phase34.js';
import { DemoScriptSchema } from '../src/skills/scriptPrompt.js';

// Generalized model A/B: compare two (or more) models on the SAME task + input so you
// can judge quality-vs-cost yourself. Same prompt, same lens, same temperature — only
// the model differs. Tasks reuse the production schemas so output shape matches the pipeline.
//
//   npm run ab -- <task> "<topic>"            task: script | angle | title
//   AB_MODELS=claude-sonnet-4-6,claude-opus-4-8 AB_SECTIONS=3 npm run ab -- title "AI tools for creators"

interface Task {
  label: string;
  system: string;
  prompt: () => string;
  schema: ZodType<any, any, any>;
  render: (data: any) => string;
}

const args = process.argv.slice(2);
const taskName = (args[0] || 'script').toLowerCase();
const topic = args.slice(1).join(' ') || 'one underrated way to grow a YouTube channel';
const sections = Math.max(1, Math.min(6, Number(process.env.AB_SECTIONS) || 3));
const models = (process.env.AB_MODELS || 'claude-sonnet-4-6,claude-opus-4-8').split(',').map((s) => s.trim()).filter(Boolean);
const lens = pickLens(); // shared across models so the only variable is the model

const bullet = (s: string) => `  • ${s}`;

const TASKS: Record<string, Task> = {
  // Full demo script — hook + sections + cta.
  script: {
    label: 'SCRIPT',
    system: SCRIPT_SYSTEM,
    prompt: () => buildDemoPrompt({ topic, sections, lens }),
    schema: DemoScriptSchema,
    render: (d) => [
      `HOOK: ${d.hook}`,
      ...d.sections.map((s: any, i: number) => `\n  [${i + 1}] (${s.on_screen})\n      ${s.vo_text}`),
      `\nCTA: ${d.cta}`,
    ].join('\n'),
  },
  // Angle ideation — mirrors the research agent's ideation step.
  angle: {
    label: 'ANGLES',
    system: 'You are a sharp YouTube strategist. Generate distinctive, specific angles with real retention potential. Avoid generic listicles and anything already saturated.',
    prompt: () => `Niche: ${topic}\nCreative lens: ${lens}\n\nReturn JSON {"candidates":[{"angle","why"}]} with 3-6 candidates.`,
    schema: IdeationSchema,
    render: (d) => d.candidates.map((c: any) => `${bullet(c.angle)}\n      ↳ ${c.why}`).join('\n'),
  },
  // Titles + thumbnails — mirrors the packaging agent.
  title: {
    label: 'TITLES + THUMBNAILS',
    system: 'You are a YouTube packaging expert writing for a broad, general audience. Write high-CTR titles (curiosity + clarity, <70 chars), compelling descriptions with keywords, and distinct thumbnail concepts described as vivid image prompts. Use plain, everyday words — no jargon, acronyms, or technical/insider terms a casual viewer wouldn\'t instantly understand. Titles and descriptions should read at a ~6th-8th-grade level.',
    prompt: () => `Topic: ${topic}\nCreative lens: ${lens}\n\nReturn JSON {titles[3-5], descriptions[1-2], thumbnail_concepts[2-3]}.`,
    schema: PackagingSchema,
    render: (d) => [
      'TITLES:',
      ...d.titles.map((t: string) => bullet(t)),
      '\nTHUMBNAILS:',
      ...d.thumbnail_concepts.map((t: string) => bullet(t)),
    ].join('\n'),
  },
};

(async () => {
  const task = TASKS[taskName];
  if (!task) { console.error(`Unknown task "${taskName}". Choose: ${Object.keys(TASKS).join(' | ')}`); process.exit(1); }
  const llm = getLLM();
  if (!llm.live) { console.error('No ANTHROPIC_API_KEY — A/B needs the live LLM.'); process.exit(1); }

  const prompt = task.prompt();
  console.log(`Task:   ${task.label}\nTopic:  ${topic}\nLens:   ${lens}\nModels: ${models.join('  vs  ')}`);

  for (const model of models) {
    const t0 = Date.now();
    try {
      const r = await llm.complete({ model, temperature: 0.7, maxTokens: 1600, schema: task.schema, system: task.system, prompt, mock: '{}' });
      console.log(`\n${'═'.repeat(74)}`);
      console.log(`  ${model}    (cost $${r.usage.costUsd.toFixed(4)} · ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
      console.log('═'.repeat(74));
      console.log(task.render(r.data));
    } catch (e) {
      console.log(`\n${model}: FAILED — ${String(e).slice(0, 200)}`);
    }
  }
  console.log('');
})().catch((e) => { console.error('ab failed:', e); process.exit(1); });
