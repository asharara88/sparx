import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createLogger } from '../logger.js';
import { defineSkill } from './registry.js';
import { ffprobeAvailable } from './mediaProbe.js';

// Cut a time range from the rendered episode and reframe 16:9 → 9:16 for Shorts.
// This is what turns the shorts plan's fictional render:// URIs into real files.
// Degrades explicitly (real:false) when ffmpeg or the source file is missing.

const log = createLogger({ mod: 'video-clipping' });

export interface ClipRequest {
  sourceUri: string;      // local path to the rendered cut
  startS: number;
  endS: number;
  outPath: string;        // where to write the vertical clip
  overlayText?: string;   // optional hook text burned in near the top (drawtext)
}

export interface ClipResult { uri: string; durationS: number; real: boolean }

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += String(d); });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${err.slice(-300)}`))));
  });
}

// drawtext parses ':', quotes, '%' and '\' specially — strip rather than escape
// (hooks are marketing copy; losing punctuation beats losing the clip).
function drawtextFilter(text: string): string {
  const safe = text.replace(/[\\':%,;=\[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 64);
  if (!safe) return '';
  return `,drawtext=text='${safe}':fontcolor=white:fontsize=56:borderw=4:bordercolor=black@0.8:x=(w-text_w)/2:y=h*0.1`;
}

/** Trim [startS, endS], center-crop to 1080x1920 vertical, optionally burn in the hook. */
export async function clipVertical(req: ClipRequest): Promise<ClipResult> {
  const durationS = Math.max(0, req.endS - req.startS);
  if (!existsSync(req.sourceUri) || !ffprobeAvailable() || durationS === 0) {
    log.warn('cannot clip (missing source or ffmpeg); returning placeholder ref', { source: req.sourceUri, durationS });
    return { uri: '', durationS, real: false };
  }
  mkdirSync(dirname(req.outPath), { recursive: true });
  // scale so height fills 1920, then center-crop width to 1080 (9:16)
  const baseVf = 'scale=-2:1920,crop=min(iw\\,1080):1920:(iw-1080)/2:0,setsar=1';
  const overlay = req.overlayText ? drawtextFilter(req.overlayText) : '';
  const args = (vf: string) => [
    '-y',
    '-ss', req.startS.toFixed(2),
    '-t', durationS.toFixed(2),
    '-i', req.sourceUri,
    '-vf', vf,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
    '-c:a', 'aac', '-movflags', '+faststart',
    req.outPath,
  ];
  try {
    await runFfmpeg(args(baseVf + overlay));
  } catch (e) {
    // ffmpeg builds without fontconfig reject drawtext — degrade to a clean clip.
    if (!overlay) throw e;
    log.warn('drawtext overlay failed; retrying without hook burn-in', { err: String(e).slice(0, 160) });
    await runFfmpeg(args(baseVf));
  }
  return { uri: req.outPath, durationS, real: true };
}

export const videoClippingSkill = defineSkill<ClipRequest, ClipResult>({
  name: 'video-clipping',
  description: 'ffmpeg trim + 9:16 vertical reframe of the rendered episode for Shorts, with optional hook-text burn-in; degrades to a placeholder result when ffmpeg/source is unavailable.',
  live: () => ffprobeAvailable(),
  run: (req) => clipVertical(req),
});
