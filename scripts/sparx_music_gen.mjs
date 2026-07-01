#!/usr/bin/env node
/**
 * Sparx / SHARARA — ElevenLabs Music CLI wrapper (Node.js)
 *
 * Mirrors sparx_music_gen.py and the existing TTS wrapper's env-var
 * convention. Same xi-api-key header/env var as the TTS wrapper — if
 * your existing wrapper uses a different env var name, rename
 * API_KEY_ENV below to match.
 *
 * Endpoint:  POST https://api.elevenlabs.io/v1/music/detailed
 * Docs:      https://elevenlabs.io/docs/api-reference/music/compose-detailed
 *
 * Usage:
 *   node sparx_music_gen.mjs "warm acoustic guitar intro, hopeful" --preset theme
 *   node sparx_music_gen.mjs "ambient pad, calm, no percussion" --preset bed --length-ms 180000
 *   node sparx_music_gen.mjs "quick rising sting" --preset sting
 *
 * Requires Node 18+ (native fetch). No external deps.
 *
 * Notes / open items (verify before relying on these in production):
 *   - model_id defaults to music_v2 for better multilingual output.
 *     API default is still music_v1 during the v1->v2 transition, so
 *     this is an explicit override, not a guess about their default.
 *   - Duration ceiling: ElevenLabs' FAQ copy says 5 min max, but the
 *     compose-detailed param spec says music_length_ms goes to 600000
 *     (10 min). Validated here against 600000; if the API rejects a
 *     request near 5 min, that's your real ceiling, not this one.
 *   - output_format is sent as a query param (matches the TTS endpoint
 *     convention) based on doc layout at write time, not a full
 *     confirmed OpenAPI spec dump.
 *   - seed is intentionally NOT exposed: per the ElevenLabs docs it
 *     can only be used with composition_plan, not plain prompt-based
 *     generation, which is all this wrapper does.
 *   - "theme" preset defaults to vocals allowed (force_instrumental:
 *     false). Vocals are only "native-like quality" in 11 of 59
 *     supported languages, and Arabic's tier wasn't confirmed in
 *     ElevenLabs' docs at write time — test an Arabic-sung theme
 *     before committing to one.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const API_BASE = "https://api.elevenlabs.io/v1/music";
const API_KEY_ENV = "ELEVENLABS_API_KEY";

const PRESETS = {
  theme: {
    music_length_ms: 30_000,
    force_instrumental: false,
    output_format: "mp3_44100_192", // 192kbps requires Creator tier+
    desc: "Intro/outro theme — vocals allowed by default",
  },
  bed: {
    music_length_ms: 120_000,
    force_instrumental: true,
    output_format: "mp3_44100_128",
    desc: "Background bed under narration — instrumental only",
  },
  sting: {
    music_length_ms: 4_000,
    force_instrumental: true,
    output_format: "mp3_44100_128",
    desc: "Short transition sting — instrumental only",
  },
};

function parseArgs(argv) {
  const args = { preset: "bed", modelId: "music_v2", outDir: "./output" };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--preset": args.preset = argv[++i]; break;
      case "--length-ms": args.lengthMs = Number(argv[++i]); break;
      case "--instrumental": args.instrumental = argv[++i] === "true"; break;
      case "--model-id": args.modelId = argv[++i]; break;
      case "--output-format": args.outputFormat = argv[++i]; break;
      case "--out-dir": args.outDir = argv[++i]; break;
      case "--filename": args.filename = argv[++i]; break;
      default: positional.push(a);
    }
  }
  args.prompt = positional.join(" ");
  return args;
}

function getApiKey() {
  const key = process.env[API_KEY_ENV];
  if (!key) {
    console.error(`Missing ${API_KEY_ENV}. Set it before running.`);
    process.exit(1);
  }
  return key;
}

async function generate(args) {
  if (!args.prompt) {
    console.error('Usage: sparx_music_gen.mjs "<prompt>" [--preset theme|bed|sting] [options]');
    process.exit(1);
  }
  if (!(args.preset in PRESETS)) {
    console.error(`Unknown preset "${args.preset}". Choose from: ${Object.keys(PRESETS).join(", ")}`);
    process.exit(1);
  }
  if (args.lengthMs !== undefined && (args.lengthMs < 3000 || args.lengthMs > 600000)) {
    console.error("--length-ms must be between 3000 and 600000");
    process.exit(1);
  }

  const preset = PRESETS[args.preset];
  const key = getApiKey();
  const outputFormat = args.outputFormat || preset.output_format;

  const payload = {
    prompt: args.prompt,
    music_length_ms: args.lengthMs ?? preset.music_length_ms,
    force_instrumental: args.instrumental ?? preset.force_instrumental,
    model_id: args.modelId,
  };

  const url = new URL(`${API_BASE}/detailed`);
  url.searchParams.set("output_format", outputFormat);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    console.error(`ElevenLabs error (HTTP ${res.status}):`);
    console.error(parsed ? JSON.stringify(parsed, null, 2) : text);
    const detail = parsed?.detail ?? parsed ?? {};
    const suggestion =
      detail.composition_plan_suggestion ||
      detail.bad_prompt_suggestion ||
      detail.suggestion;
    if (suggestion) console.error(`\nSuggested fix: ${suggestion}`);
    process.exit(1);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(args.outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const ext = outputFormat.split("_")[0];
  const filename = args.filename || `${args.preset}_${ts}.${ext}`;
  const outPath = path.join(args.outDir, filename);
  await writeFile(outPath, buf);
  console.log(`Saved: ${outPath}`);
  return outPath;
}

const args = parseArgs(process.argv.slice(2));
generate(args).catch((err) => {
  console.error(err);
  process.exit(1);
});
