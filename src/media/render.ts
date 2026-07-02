import { spawn, spawnSync } from 'node:child_process';
import { closeSync, createWriteStream, existsSync, mkdirSync, openSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createLogger } from '../logger.js';
import { config } from '../config.js';
import { mapLimit } from '../util/concurrency.js';
import { fetchWithRetry } from '../util/http.js';
import { probeMedia } from '../skills/mediaProbe.js';

// Final render / compositing. Takes the editor's EDL and turns it into ONE real
// mp4 via ffmpeg: each shot becomes a normalized 1280x720 clip (real footage when
// the URI is a downloadable http(s) URL, a captioned placeholder slate otherwise),
// then all shots are concatenated and optional background music is mixed in.
// Remote assets download in parallel (bounded by MEDIA_CONCURRENCY, streamed to
// disk); encodes stay sequential but run through async spawn so the event loop —
// and the captions agent running concurrently in the same stage — never block.
// Degrades gracefully: if ffmpeg is absent the caller keeps the placeholder ref.
const log = createLogger({ mod: 'render' });

const W = 1280, H = 720, FPS = 30;
const BG = '0x14142B';
const FFMPEG_TIMEOUT_MS = 10 * 60_000; // per invocation; a hung encode must not hang the pipeline

export interface RenderShot {
  visual_uri: string | null;
  audio_uri: string | null;
  // Narration used only if the visual (whose baked-in audio was expected to carry
  // the shot, e.g. an avatar clip) can't be fetched or has no audio stream.
  fallback_audio_uri?: string | null;
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

let ffmpegOk: boolean | null = null;
export function ffmpegAvailable(): boolean {
  if (ffmpegOk !== null) return ffmpegOk;
  try { ffmpegOk = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0; }
  catch { ffmpegOk = false; }
  return ffmpegOk;
}

/** Run ffmpeg asynchronously (spawn, not spawnSync — a multi-minute encode must not block the event loop). */
function ff(args: string[]): Promise<void> {
  return new Promise((done, fail) => {
    const child = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => { stderr = (stderr + d.toString()).slice(-4000); });
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, FFMPEG_TIMEOUT_MS);
    child.on('error', (err) => { clearTimeout(timer); fail(new Error(`ffmpeg failed: ${String(err.message).slice(-400)}`)); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) done();
      else if (signal) fail(new Error(`ffmpeg killed (${signal}) after ${FFMPEG_TIMEOUT_MS}ms`));
      else fail(new Error(`ffmpeg failed: ${(stderr || `exit ${code}`).slice(-400)}`));
    });
  });
}

const isHttp = (uri: string | null | undefined): uri is string => !!uri && /^https?:\/\//i.test(uri);
const isImage = (uri: string) => /\.(jpe?g|png|webp|gif|bmp)(\?|$)/i.test(uri);

/** Escape a value used inside -filter_complex options (':' separates options, ',' filters). */
const escFilter = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:').replace(/,/g, '\\,');

// Sniff a local file's magic bytes: extension-based detection misses extensionless
// signed URLs (Runway/HeyGen), which would loop a still image as a 1-frame "video".
function isImageFile(path: string): boolean {
  try {
    const fd = openSync(path, 'r');
    const buf = Buffer.alloc(12);
    const n = readSync(fd, buf, 0, 12, 0);
    closeSync(fd);
    if (n >= 4) {
      if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;                                    // JPEG
      if (buf.readUInt32BE(0) === 0x89504e47) return true;                                                       // PNG
      if (buf.toString('ascii', 0, 3) === 'GIF') return true;                                                    // GIF
      if (buf.toString('ascii', 0, 2) === 'BM') return true;                                                     // BMP
      if (n >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return true; // WebP
    }
  } catch { /* fall through to extension */ }
  return isImage(path);
}

async function download(url: string, dest: string): Promise<boolean> {
  try {
    const res = await fetchWithRetry(url, {}, { label: 'render.asset' });
    if (!res.body) return false;
    await pipeline(Readable.fromWeb(res.body as unknown as import('node:stream/web').ReadableStream), createWriteStream(dest));
    if (statSync(dest).size === 0) {
      log.warn('asset download produced an empty file; using placeholder', { url: url.slice(0, 140) });
      return false;
    }
    return true;
  } catch (e) {
    // A dead asset (expired signed URL, 403, timeout) degrades to a placeholder slate —
    // but loudly, so it's diagnosable instead of a silent real→placeholder flip.
    log.warn('asset download failed; using placeholder', { url: url.slice(0, 140), err: String(e).slice(0, 160) });
    return false;
  }
}

// Resolve a media URI to a usable local file: download http(s), pass through an
// existing local path, or give up (mock://, mem://, missing) → caller uses a placeholder.
async function resolveInput(uri: string | null | undefined, dest: string): Promise<string | null> {
  if (!uri) return null;
  if (isHttp(uri)) return (await download(uri, dest)) ? dest : null;
  if (existsSync(uri)) return uri;
  return null;
}

async function probeDurationS(path: string): Promise<number | null> {
  const d = (await probeMedia(path))?.durationS ?? 0;
  return d > 0 ? d : null;
}

async function hasAudioStream(path: string): Promise<boolean> {
  return (await probeMedia(path))?.hasAudio ?? false;
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

interface ResolvedInputs { visual: string | null; audio: string | null; fallbackAudio: string | null }

async function buildShot(i: number, shot: RenderShot, inputs: ResolvedInputs, tmpDir: string, font: string | null): Promise<{ path: string; real: boolean; durationS: number }> {
  let dur = Math.max(1, Math.round(shot.duration_s || 4));
  const out = join(tmpDir, `shot_${String(i).padStart(3, '0')}.mp4`);
  const { visual, fallbackAudio } = inputs;
  const visualIsImage = !!visual && isImageFile(visual);
  const visualIsVideo = !!visual && !visualIsImage;

  // Audio source priority: explicit voiceover file > the visual video's own baked-in
  // audio (e.g. a HeyGen avatar that already speaks) > the fallback narration (when
  // the avatar clip the audio was delegated to didn't materialize) > silence.
  let audio = inputs.audio;
  let audioSource: 'file' | 'visual' | 'silence';
  if (audio) audioSource = 'file';
  else if (visualIsVideo && (await hasAudioStream(visual!))) audioSource = 'visual';
  else if (fallbackAudio) { audio = fallbackAudio; audioSource = 'file'; }
  else audioSource = 'silence';

  // Fit the shot to the narration / avatar clip so nothing is cut off.
  if (audioSource === 'file') { const ad = await probeDurationS(audio!); if (ad) dur = Math.max(dur, Math.ceil(ad)); }
  else if (audioSource === 'visual') { const vd = await probeDurationS(visual!); if (vd) dur = Math.max(dur, Math.ceil(vd)); }

  // drawtext overlay (only when we have a font and a caption).
  let draw = '';
  if (font && shot.caption?.trim()) {
    const capFile = join(tmpDir, `cap_${i}.txt`);
    writeFileSync(capFile, wrapCaption(shot.caption));
    draw = `,drawtext=fontfile=${escFilter(font)}:textfile=${escFilter(capFile)}:reload=0:fontcolor=white:fontsize=34:line_spacing=8:box=1:boxcolor=0x000000AA:boxborderw=16:x=(w-text_w)/2:y=h-text_h-48`;
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
    // '-ac 2' keeps every clip's channel layout identical (mono voiceovers would
    // otherwise break the stream-copy concat).
    '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-b:a', '128k',
    out,
  );
  await ff(args);
  return { path: out, real: !!visual, durationS: dur };
}

export async function renderEpisode(opts: RenderOptions): Promise<RenderResult> {
  if (!opts.shots.length) throw new Error('render: no shots');
  const dir = opts.outDir ?? join('generated', opts.episodeId);
  const tmp = join(dir, 'render_tmp');
  mkdirSync(tmp, { recursive: true });
  const font = FONT_CANDIDATES.find(existsSync) ?? null;
  if (!font) log.warn('no system font found; rendering without burned captions');

  try {
    // 1) Resolve every input up front, remote downloads in parallel (bounded) — a
    //    20-shot episode no longer pays 20 serial round-trips before encoding starts.
    //    Memoized by URI so an asset reused across shots is downloaded once.
    const limit = config().MEDIA_CONCURRENCY;
    const fetched = new Map<string, Promise<string | null>>();
    const memoResolve = (uri: string | null | undefined, dest: string): Promise<string | null> => {
      if (!uri) return Promise.resolve(null);
      let p = fetched.get(uri);
      if (!p) { p = resolveInput(uri, dest); fetched.set(uri, p); }
      return p;
    };
    const musicPending = memoResolve(opts.musicUri, join(tmp, 'music.mp3'));
    const inputs: ResolvedInputs[] = await mapLimit(opts.shots, limit, async (shot, i) => {
      const visExt = shot.visual_uri && isImage(shot.visual_uri) ? 'jpg' : 'mp4';
      const [visual, audio, fallbackAudio] = await Promise.all([
        memoResolve(shot.visual_uri, join(tmp, `vis_${i}.${visExt}`)),
        memoResolve(shot.audio_uri, join(tmp, `aud_${i}.mp3`)),
        memoResolve(shot.fallback_audio_uri, join(tmp, `aud_fb_${i}.mp3`)),
      ]);
      return { visual, audio, fallbackAudio };
    });

    // 2) Per-shot encodes (sequential — deterministic and gentle on CPU/memory; the
    //    async spawn keeps the process responsive while each encode runs).
    const clips: { path: string; real: boolean; durationS: number }[] = [];
    for (const [i, shot] of opts.shots.entries()) clips.push(await buildShot(i, shot, inputs[i]!, tmp, font));
    const real = clips.filter((c) => c.real).length;

    // 3) Concat + optional music (ducked under the voiceover) in ONE pass. Every clip
    //    was just encoded with identical codec params (libx264/yuv420p/fps + aac/
    //    44100/stereo), so the video stream copies straight through the concat
    //    demuxer — re-encoding the full episode a second time buys nothing.
    //    +faststart moves the moov atom to the front so browsers can start playback
    //    before the byte-range streaming has delivered the whole file.
    const musicSrc = await musicPending;
    const listFile = join(tmp, 'concat.txt');
    writeFileSync(listFile, clips.map((c) => `file '${resolve(c.path).replace(/'/g, "'\\''")}'`).join('\n'));
    const finalPath = join(dir, 'cut.mp4');
    let music = false;
    if (musicSrc) {
      await ff([
        '-f', 'concat', '-safe', '0', '-i', listFile, '-stream_loop', '-1', '-i', musicSrc,
        '-filter_complex', '[1:a]volume=0.15[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=2[a]',
        '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-ar', '44100', '-shortest', '-movflags', '+faststart', finalPath,
      ]);
      music = true;
    } else {
      await ff(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', finalPath]);
    }

    const durationS = clips.reduce((n, c) => n + c.durationS, 0);
    return { path: resolve(finalPath), durationS, shots: clips.length, real, placeholders: clips.length - real, music };
  } finally {
    // Cleanup intermediates (also on failure — no leaked render_tmp), keep the final cut.
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}
