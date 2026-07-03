import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { getAvatar } from '../src/media/avatar.js';
import { config } from '../src/config.js';

// Isolated lip-sync realism test. Drives the SAME provider path the pipeline uses
// (src/media/avatar.ts -> HeyGen /v2/video/generate, avatar_style 'normal'), with one
// short line, then downloads the finished MP4 locally so you can eyeball the mouth.
//
//   npm run lipsync:test                 # default stress line
//   npm run lipsync:test -- "your line"  # custom line

// A line chosen to stress sync: bilabial plosives (b/p/m), open vowels, and a pace shift.
const DEFAULT_LINE =
  "Welcome back. Today we're breaking down the best AI tools for creators — buckle up, because this one moves fast.";

const line = process.argv.slice(2).join(' ').trim() || DEFAULT_LINE;
const c = config();

if (!c.HEYGEN_API_KEY) {
  console.error('No HEYGEN_API_KEY set — this would only produce a mock:// URI, not real video. Aborting.');
  process.exit(1);
}

const provider = getAvatar();
const words = line.split(/\s+/).filter(Boolean).length;
const durationS = Math.max(2, Math.round(words / 2.3));

console.log(`Provider : ${provider.name} (live=${provider.live})`);
console.log(`Avatar   : ${c.HEYGEN_AVATAR_ID}`);
console.log(`Voice    : ${c.HEYGEN_VOICE_ID}`);
console.log(`Line     : ${line}`);
console.log(`Est dur  : ~${durationS}s`);
console.log('Submitting to HeyGen and polling (can take 1-3 min)...');

const t0 = Date.now();
const art = await provider.generate({ text: line, avatarId: c.HEYGEN_AVATAR_ID, voiceId: c.HEYGEN_VOICE_ID, durationS });
const elapsed = ((Date.now() - t0) / 1000).toFixed(0);

if (!art.uri || art.uri.startsWith('mock://')) {
  console.error(`No real video URL returned (got ${art.uri}). Aborting.`);
  process.exit(1);
}

const res = await fetch(art.uri);
if (!res.ok) { console.error(`Download failed: ${res.status}`); process.exit(1); }
const buf = Buffer.from(await res.arrayBuffer());

const dir = resolve('generated/lipsync-test');
mkdirSync(dir, { recursive: true });
const out = join(dir, `lipsync_${Date.now()}.mp4`);
writeFileSync(out, buf);

console.log(`\n✓ Saved   : ${out}`);
console.log(`  Size    : ${(buf.length / 1024).toFixed(0)} KB`);
console.log(`  Duration: ${art.durationS}s   Render time: ${elapsed}s   Cost: $${art.costUsd}`);
console.log(`  Source  : ${art.uri}`);
