import 'dotenv/config';
import { z } from 'zod';
import { getLLM } from '../src/llm/client.js';
import { SCRIPT_SYSTEM, buildDemoPrompt, pickLens } from '../src/skills/scriptPrompt.js';

// A/B the SAME script prompt across two models so you can judge quality vs cost
// yourself. Same topic, same lens, same temperature — only the model differs.
//   npm run script:ab -- "your topic here"
//   AB_MODELS=claude-sonnet-4-6,claude-opus-4-8 AB_SECTIONS=3 npm run script:ab -- "topic"
const topic = process.argv.slice(2).join(' ') || 'one underrated way to grow a YouTube channel';
const sections = Math.max(1, Math.min(6, Number(process.env.AB_SECTIONS) || 3));
const models = (process.env.AB_MODELS || 'claude-sonnet-4-6,claude-opus-4-8').split(',').map((s) => s.trim()).filter(Boolean);

const Script = z.object({
  hook: z.string(),
  sections: z.array(z.object({ vo_text: z.string(), on_screen: z.string() })),
  cta: z.string(),
});

function render(label: string, data: z.infer<typeof Script>, costUsd: number, ms: number) {
  const lines: string[] = [];
  lines.push(`\n${'═'.repeat(72)}`);
  lines.push(`  ${label}    (cost $${costUsd.toFixed(4)} · ${(ms / 1000).toFixed(1)}s)`);
  lines.push('═'.repeat(72));
  lines.push(`HOOK: ${data.hook}`);
  data.sections.forEach((s, i) => {
    lines.push(`\n  [${i + 1}] (${s.on_screen})`);
    lines.push(`      ${s.vo_text}`);
  });
  lines.push(`\nCTA: ${data.cta}`);
  return lines.join('\n');
}

(async () => {
  const llm = getLLM();
  if (!llm.live) { console.error('No ANTHROPIC_API_KEY — A/B needs the live LLM.'); process.exit(1); }
  // One shared lens so the only variable is the model.
  const lens = pickLens();
  const prompt = buildDemoPrompt({ topic, sections, lens });
  console.log(`Topic: ${topic}\nLens:  ${lens}\nModels: ${models.join('  vs  ')}\n`);

  for (const model of models) {
    const t0 = Date.now();
    try {
      const r = await llm.complete({ model, temperature: 0.7, maxTokens: 1500, schema: Script, system: SCRIPT_SYSTEM, prompt, mock: '{}' });
      console.log(render(model, r.data!, r.usage.costUsd, Date.now() - t0));
    } catch (e) {
      console.log(`\n${model}: FAILED — ${String(e).slice(0, 200)}`);
    }
  }
  console.log('');
})().catch((e) => { console.error('ab failed:', e); process.exit(1); });
