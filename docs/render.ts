import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import ffmpegPath from 'ffmpeg-static';
import { createLogger } from '../logger.js';

// Video render step: turns the Editor's EDL into a real MP4 via ffmpeg
// (per-segment normalize -> concat -> mix music) plus an .srt caption sidecar.
// Activates when segments reference REAL assets (http/local); on mock assets it
// returns a placeholder so the pipeline still completes offline.
const log = createLogger({ mod: 'render' });
const run = promisify(execFile);
const FFMPEG = (ffmpegPath as unknown as string) || 'ffmpeg';

export interface RenderSegment { visual: string; audio?: string; durationS: number; caption?: string }
export interface RenderInput { episodeId: string; segments: RenderSegment[]; music?: string; outDir?: string; width?: number; height?: number }
export interface RenderResult { path: string; rendered: boolean; bytes?: number; srtPath?: string }

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i;
const MOCK_SCHEME = /^(mock|render|mem):\/\//i;

export function isRealAsset(uri: string | undefined): uri is string {
  if (!uri) return false;
  if (MOCK_SCHEME.test(uri)) return false;
  return /^https?:\/\//i.test(uri) || uri.startsWith('/');
}

// Pure: ffmpeg args to normalize ONE segment to a fixed-size clip of `durationS`.
export function segmentArgs(opts: { visual: string; audio?: string; durationS: number; width: number; height: number; isImage: boolean; out: string }): string[] {
  const { visual, audio, durationS, width, height, isImage, out } = opts;
  const vf = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30`;
  const args: string[] = ['-y'];
  if (isImage) args.push('-loop', '1', '-t', String(durationS), '-i', visual);
  else args.push('-i', visual);
  if (audio) args.push('-i', audio);
  else args.push('-f', 'lavfi', '-t', String(durationS), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
  args.push('-vf', vf, '-t', String(durationS),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30',
    '-c:a', 'aac', '-ar', '44100', '-ac', '2',
    '-map', '0:v:0', '-map', '1:a:0', '-shortest', out);
  return args;
}

export function buildSrt(segments: RenderSegment[]): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const ts = (s: number) => `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(Math.floor(s % 60))},${pad(Math.round((s % 1) * 1000), 3)}`;
  let t = 0; const out: string[] = [];
  segments.forEach((seg, i) => {
    const start = t; t += seg.durationS;
    if (seg.caption) out.push(`${i + 1}\n${ts(start)} --> ${ts(t)}\n${seg.caption}\n`);
  });
  return out.join('\n');
}

async function ensureLocal(uri: string, dir: string, name: string): Promise<string> {
  if (uri.startsWith('/')) return uri;
  const ext = (uri.match(/\.[a-z0-9]{2,4}(?=$|\?)/i)?.[0] ?? '').toLowerCase() || '.bin';
  const dest = join(dir, `${name}${ext}`);
  const res = await fetch(uri);
  if (!res.ok) throw new Error(`download ${res.status} for ${uri}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

export async function renderEpisode(input: RenderInput): Promise<RenderResult> {
  const width = input.width ?? 1920, height = input.height ?? 1080;
  const renderable = input.segments.filter((s) => isRealAsset(s.visual));
  if (renderable.length === 0) {
    log.info('no real assets; skipping render (placeholder)', { episode: input.episodeId });
    return { path: `render://${input.episodeId}/cut.mp4`, rendered: false };
  }

  const outDir = input.outDir ?? join('generated', input.episodeId);
  mkdirSync(outDir, { recursive: true });
  const work = join(tmpdir(), `render_${input.episodeId}_${Date.now()}`);
  mkdirSync(work, { recursive: true });

  // 1) normalize each segment to a uniform clip
  const segPaths: string[] = [];
  for (let i = 0; i < input.segments.length; i++) {
    const seg = input.segments[i]!;
    if (!isRealAsset(seg.visual)) continue;
    const visual = await ensureLocal(seg.visual, work, `v${i}`);
    const audio = isRealAsset(seg.audio) ? await ensureLocal(seg.audio!, work, `a${i}`) : undefined;
    const out = join(work, `seg${i}.mp4`);
    await run(FFMPEG, segmentArgs({ visual, audio, durationS: seg.durationS, width, height, isImage: IMAGE_EXT.test(visual), out }));
    segPaths.push(out);
  }

  // 2) concat segments
  const listFile = join(work, 'list.txt');
  writeFileSync(listFile, segPaths.map((p) => `file '${p}'`).join('\n'));
  const concatOut = join(work, 'concat.mp4');
  await run(FFMPEG, ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', concatOut]);

  // 3) mix music (optional)
  const finalOut = join(outDir, 'cut.mp4');
  if (isRealAsset(input.music)) {
    const music = await ensureLocal(input.music!, work, 'music');
    await run(FFMPEG, ['-y', '-i', concatOut, '-i', music, '-filter_complex',
      '[1:a]volume=0.15[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=2[a]',
      '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', finalOut]);
  } else {
    await run(FFMPEG, ['-y', '-i', concatOut, '-c', 'copy', finalOut]);
  }

  // 4) caption sidecar
  let srtPath: string | undefined;
  const srt = buildSrt(input.segments);
  if (srt.trim()) { srtPath = join(outDir, 'captions.srt'); writeFileSync(srtPath, srt); }

  const bytes = existsSync(finalOut) ? statSync(finalOut).size : 0;
  log.info('render complete', { episode: input.episodeId, segments: segPaths.length, bytes });
  return { path: finalOut, rendered: true, bytes, srtPath };
}
