import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createLogger } from '../logger.js';

// Final render / compositing. Takes the editor's EDL and turns it into ONE real
// mp4 via ffmpeg: each shot becomes a normalized 1280x720 clip (real footage when
// the URI is a downloadable http(s) URL, a captioned placeholder slate otherwise),
// then all shots are concatenated and optional background music is mixed in.
// Degrades gracefully: if ffmpeg is absent the caller keeps the placeholder ref.
const log = createLogger({ mod: 'render' });

const W = 1280, H = 720, FPS = 30;
const BG = '0x14142B';

export interface RenderShot {
  visual_uri: string | null;
  audio_uri: string | null;
  duration_s: number;
  caption?: string;
}
export interface RenderOptions {
  episodeId: string;
  shots: RenderShot[];
  musicUri?: string | null;
  outDir?: string;
}
export interface RenderResult { path: string; durationS: number; shots: number; real: number; placeholders: number; music: boolean }

const FONT_CANDIDATES = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
  '/usr/share/fonts/truetype/freefont/FreeSans.ttf',
  '/usr/share/fonts/TTF/DejaVuSans.ttf',
  '/System/Library/Fonts/Supplemental/Arial.ttf',
];

export function ffmpegAvailable(): boolean {
  try { return spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0; }
  catch { return false; }
}

function ff(args: string[]): void {
  const r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${(r.stderr || r.error?.message || 'unknown').slice(-400)}`);
}

const isHttp = (uri: string | null | undefined): uri is string => !!uri && /^https?:\/\//i.test(uri);
const isImage = (uri: string) => /\.(jpe?g|png|webp|gif|bmp)(\?|$)/i.test(uri);

async function download(url: string, dest: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) return false;
    writeFileSync(dest, buf);
    return true;
  } catch { return false; }
}

// Resolve a media URI to a usable local file: download http(s), pass through an
// existing local path, or give up (mock://, mem://, missing) → caller uses a placeholder.
async function resolveInput(uri: string | null | undefined, dest: string): Promise<string | null> {
  if (!uri) return null;
  if (isHttp(uri)) return (await download(uri, dest)) ? dest : null;
  if (existsSync(uri)) return uri;
  return null;
}

function probeDurationS(path: string): number | null {
  try {
    const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path], { encoding: 'utf8' });
    const d = parseFloat((r.stdout ?? '').trim());
    return Number.isFinite(d) && d > 0 ? d : null;
  } catch { return null; }
}

function hasAudioStream(path: string): boolean {
  try {
    const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_type', '-of', 'default=nw=1', path], { encoding: 'utf8' });
    return /codec_type=audio/.test(r.stdout ?? '');
  } catch { return false; }
}

// Wrap to ~52 chars/line, max 3 lines, so drawtext (no auto-wrap) stays on-screen.
function wrapCaption(text: string): string {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > 52) { lines.push(cur.trim()); cur = w; }
    else cur += ' ' + w;
    if (lines.length === 3) break;
  }
  if (cur.trim() && lines.length < 3) lines.push(cur.trim());
  return lines.slice(0, 3).join('\n');
}

const NORMALIZE = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${BG},setsar=1,fps=${FPS},format=yuv420p`;

async function buildShot(i: number, shot: RenderShot, tmpDir: string, font: string | null): Promise<{ path: string; real: boolean; durationS: number }> {
  let dur = Math.max(1, Math.round(shot.duration_s || 4));
  const out = join(tmpDir, `shot_${String(i).padStart(3, '0')}.mp4`);

  // Resolve real inputs (best effort): http download or existing local file.
  const visExt = shot.visual_uri && isImage(shot.visual_uri) ? 'jpg' : 'mp4';
  const visual = await resolveInput(shot.visual_uri, join(tmpDir, `vis_${i}.${visExt}`));
  const audio = await resolveInput(shot.audio_uri, join(tmpDir, `aud_${i}.mp3`));
  const visualIsImage = !!visual && isImage(visual);
  const visualIsVideo = !!visual && !visualIsImage;

  // Audio source priority: explicit voiceover file > the visual video's own baked-in
  // audio (e.g. a HeyGen avatar that already speaks) > silence.
  const audioSource: 'file' | 'visual' | 'silence' = audio ? 'file' : (visualIsVideo && hasAudioStream(visual!) ? 'visual' : 'silence');

  // Fit the shot to the narration / avatar clip so nothing is cut off.
  if (audioSource === 'file') { const ad = probeDurationS(audio!); if (ad) dur = Math.max(dur, Math.ceil(ad)); }
  else if (audioSource === 'visual') { const vd = probeDurationS(visual!); if (vd) dur = Math.max(dur, Math.ceil(vd)); }

  // drawtext overlay (only when we have a font and a caption).
  let draw = '';
  if (font && shot.caption?.trim()) {
    const capFile = join(tmpDir, `cap_${i}.txt`);
    writeFileSync(capFile, wrapCaption(shot.caption));
    draw = `,drawtext=fontfile=${font}:textfile=${capFile}:reload=0:fontcolor=white:fontsize=34:line_spacing=8:box=1:boxcolor=0x000000AA:boxborderw=16:x=(w-text_w)/2:y=h-text_h-48`;
  }

  const args: string[] = [];
  let vChain: string;
  if (visualIsImage) {
    args.push('-loop', '1', '-t', String(dur), '-i', visual!);
    vChain = `[0:v]${NORMALIZE}${draw}[v]`;
  } else if (visualIsVideo) {
    // Keep the avatar's audio → play once; otherwise loop the clip to fill the shot.
    if (audioSource === 'visual') args.push('-i', visual!);
    else args.push('-stream_loop', '-1', '-i', visual!);
    vChain = `[0:v]${NORMALIZE}${draw}[v]`;
  } else {
    args.push('-f', 'lavfi', '-t', String(dur), '-i', `color=c=${BG}:s=${W}x${H}:r=${FPS}`);
    vChain = `[0:v]fps=${FPS},format=yuv420p${draw}[v]`;
  }

  // Audio input + filter (input index 1 unless we're reusing the visual's own audio).
  let aChain: string;
  if (audioSource === 'file') { args.push('-i', audio!); aChain = '[1:a]aresample=44100,apad[a]'; }
  else if (audioSource === 'visual') { aChain = '[0:a]aresample=44100,apad[a]'; }
  else { args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100'); aChain = '[1:a]aresample=44100,apad[a]'; }

  args.push(
    '-filter_complex', `${vChain};${aChain}`,
    '-map', '[v]', '-map', '[a]',
    '-t', String(dur),
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-c:a', 'aac', '-ar', '44100', '-b:a', '128k',
    out,
  );
  ff(args);
  return { path: out, real: !!visual, durationS: dur };
}

export async function renderEpisode(opts: RenderOptions): Promise<RenderResult> {
  if (!opts.shots.length) throw new Error('render: no shots');
  const dir = opts.outDir ?? join('generated', opts.episodeId);
  const tmp = join(dir, 'render_tmp');
  mkdirSync(tmp, { recursive: true });
  const font = FONT_CANDIDATES.find(existsSync) ?? null;
  if (!font) log.warn('no system font found; rendering without burned captions');

  // 1) Per-shot clips (sequential — deterministic and gentle on memory).
  const clips: { path: string; real: boolean; durationS: number }[] = [];
  for (const [i, shot] of opts.shots.entries()) clips.push(await buildShot(i, shot, tmp, font));
  const real = clips.filter((c) => c.real).length;

  // 2) Concat (re-encode; all clips share identical codec params so this is clean).
  const musicSrc = await resolveInput(opts.musicUri, join(tmp, 'music.mp3'));
  const listFile = join(tmp, 'concat.txt');
  writeFileSync(listFile, clips.map((c) => `file '${resolve(c.path)}'`).join('\n'));
  const concatOut = musicSrc ? join(tmp, 'cut_nomusic.mp4') : join(dir, 'cut.mp4');
  ff(['-f', 'concat', '-safe', '0', '-i', listFile, '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '44100', concatOut]);

  // 3) Optional background music, ducked under the voiceover.
  let music = false;
  let finalPath = concatOut;
  if (musicSrc) {
    finalPath = join(dir, 'cut.mp4');
    ff([
      '-i', concatOut, '-stream_loop', '-1', '-i', musicSrc,
      '-filter_complex', '[1:a]volume=0.15[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=2[a]',
      '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-ar', '44100', '-shortest', finalPath,
    ]);
    music = true;
  }

  // 4) Cleanup intermediates, keep the final cut.
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }

  const durationS = clips.reduce((n, c) => n + c.durationS, 0);
  return { path: resolve(finalPath), durationS, shots: clips.length, real, placeholders: clips.length - real, music };
}
