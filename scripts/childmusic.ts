// Music & Early-Childhood specialist CLI — turn a caregiver/product request into
// a graded, safety-checked AI-music-generation brief (ElevenLabs / Suno / Udio).
//
//   npm run childmusic -- "help my 4-month-old fall asleep"
//   npm run childmusic -- --goal play --age 8 --lang en
//   npm run childmusic -- --goal focus --age 20 --lang ar,en --tool suno
//   npm run childmusic -- "calming song" --age 2 --speaker crib      # blocked demo
//   npm run childmusic -- "bedtime" --age 1 --json                   # machine output
//
// This prints the brief (guidelines for prompting AI music). It does NOT call a
// music provider — hand the printed tool prompt to your generator of choice
// (e.g. the ElevenLabs prompt to `npm run music:gen`).

import { composeChildMusicBrief } from '../src/childmusic/index.js';
import type { ChildMusicRequest, DeliveryContext, MusicTool } from '../src/childmusic/index.js';

function parseArgs(argv: string[]): { req: ChildMusicRequest; tool?: MusicTool; json: boolean } {
  const req: ChildMusicRequest = {};
  const delivery: DeliveryContext = {};
  let tool: MusicTool | undefined;
  let json = false;
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--goal': req.goal = argv[++i] as ChildMusicRequest['goal']; break;
      case '--intent': req.intent = argv[++i] as ChildMusicRequest['intent']; break;
      case '--age': req.ageMonths = Number(argv[++i]); break;
      case '--stage': req.stage = argv[++i] as ChildMusicRequest['stage']; break;
      case '--prenatal': req.prenatal = true; break;
      case '--lang': req.languages = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--length-ms': req.lengthMs = Number(argv[++i]); break;
      case '--speaker': delivery.speaker = argv[++i] as DeliveryContext['speaker']; break;
      case '--continuous': delivery.continuous = true; break;
      case '--nicu': delivery.nicu = true; break;
      case '--no-caregiver': delivery.caregiverPresent = false; break;
      case '--tool': tool = argv[++i] as MusicTool; break;
      case '--json': json = true; break;
      default: positional.push(a!);
    }
  }
  if (positional.length) req.text = positional.join(' ');
  if (Object.keys(delivery).length) req.delivery = delivery;
  return { req, tool, json };
}

const GRADE_MARK: Record<string, string> = {
  Strong: '✅ Strong',
  Moderate: '🟡 Moderate',
  Emerging: '🔬 Emerging',
  Contested: '⚠️  Contested',
  Debunked: '⛔ Debunked',
};

const { req, tool, json } = parseArgs(process.argv.slice(2));

if (!req.text && !req.goal && req.ageMonths === undefined && !req.stage && !req.prenatal) {
  console.error('usage: npm run childmusic -- "<request>" [--goal sleep|calm|play|feeding|focus|entertain] [--age <months>] [--stage <id>] [--prenatal] [--lang en,ar] [--speaker room|crib|near-ear|headphones] [--continuous] [--nicu] [--tool elevenlabs|suno|udio] [--json]');
  process.exit(1);
}

const brief = composeChildMusicBrief(req);

if (json) {
  console.log(JSON.stringify(tool ? { ...brief, prompts: { [tool]: brief.prompts[tool] } } : brief, null, 2));
  process.exit(brief.status === 'ok' ? 0 : 2);
}

const line = (s = '') => console.log(s);
line(`\n🎵 ${brief.summary}`);
line(`   ${brief.goal.trace}`);
line(`   stage: ${brief.stage.label}  ·  windows: ${brief.stage.windows.join(', ') || 'none active'}`);
line(`   ${brief.stage.screenNote}`);

line('\n── Parameters (graded) ─────────────────────────────');
for (const c of brief.parameters.choices) {
  line(`  • ${c.key}: ${c.value}  [${GRADE_MARK[c.grade] ?? c.grade}]`);
}
if (brief.parameters.notes.length) brief.parameters.notes.forEach((n) => line(`  ⓘ ${n}`));

line('\n── Lyrics ──────────────────────────────────────────');
line(`  languages: ${brief.lyrics.languages.join(', ')}${brief.lyrics.instrumental ? ' (instrumental)' : ''}`);
brief.lyrics.sections.forEach((s) => line(`  ${s.tag} (${s.lang}) ${s.text.replace(/\n/g, ' / ')}`));
brief.lyrics.guidance.forEach((g) => line(`  ⓘ ${g}`));

line('\n── Evidence-grounded claims ────────────────────────');
if (!brief.claims.length) line('  (entertainment track — no developmental claims)');
for (const c of brief.claims) {
  const mark = c.allowed ? (GRADE_MARK[c.grade] ?? c.grade) : `⛔ BLOCKED (${c.grade})`;
  line(`  • [${mark}] ${c.claim}`);
  if (!c.allowed && c.rewrite) line(`      ↳ say instead: ${c.rewrite}`);
}

line('\n── Safety ──────────────────────────────────────────');
line(`  status: ${brief.safety.passed ? 'PASS' : 'BLOCKED'}`);
brief.safety.blocks.forEach((b) => line(`  ⛔ ${b}`));
brief.safety.warnings.forEach((w) => line(`  ⚠️  ${w}`));
brief.safety.guidance.forEach((g) => line(`  ✓ ${g}`));

const tools: MusicTool[] = tool ? [tool] : ['elevenlabs', 'suno', 'udio'];
line('\n── Tool prompts ────────────────────────────────────');
for (const t of tools) {
  line(`\n  [${t}]`);
  line(`  ${JSON.stringify(brief.prompts[t], null, 2).replace(/\n/g, '\n  ')}`);
}

line(`\n${brief.status === 'ok' ? '✅ Brief cleared for generation.' : '⛔ Brief BLOCKED by the safety gate — resolve the blocks above before generating.'}\n`);
process.exit(brief.status === 'ok' ? 0 : 2);
