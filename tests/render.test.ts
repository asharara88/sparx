import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ffmpegAvailable, renderEpisode, type RenderShot } from '../src/media/render.js';

// Renderer unit tests. Fixtures are generated locally with ffmpeg's lavfi sources
// (no network), then fed through renderEpisode() and verified with ffprobe — so the
// real EDL -> mp4 path is exercised end-to-end against actual encoded output.
const HAS_FFMPEG = ffmpegAvailable();
const d = HAS_FFMPEG ? describe : describe.skip;

function probe(path: string) {
  const r = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height', '-of', 'json', path],
    { encoding: 'utf8' },
  );
  const j = JSON.parse(r.stdout || '{}');
  const v = (j.streams ?? []).find((s: any) => s.codec_type === 'video');
  const a = (j.streams ?? []).find((s: any) => s.codec_type === 'audio');
  return {
    duration: parseFloat(j.format?.duration ?? '0'),
    video: v ? { codec: v.codec_name, width: v.width, height: v.height } : null,
    audio: a ? { codec: a.codec_name } : null,
  };
}

// A self-contained local clip (colour + tone) so resolveInput() treats it as real footage.
function makeClip(path: string, color: string, durationS: number) {
  const r = spawnSync('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `color=c=${color}:s=640x480:r=30:d=${durationS}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${durationS}`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path,
  ]);
  if (r.status !== 0) throw new Error(`fixture clip failed: ${r.stderr}`);
}

d('renderEpisode (EDL -> mp4)', () => {
  let work: string;
  let clipA: string;
  let music: string;
  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), 'render-test-'));
    clipA = join(work, 'clipA.mp4');
    music = join(work, 'music.mp4');
    makeClip(clipA, 'blue', 2);
    makeClip(music, 'black', 4);
  }, 60_000);
  afterAll(() => { rmSync(work, { recursive: true, force: true }); });

  it('renders real footage + a placeholder shot into one normalized 1280x720 H.264/AAC mp4', async () => {
    const shots: RenderShot[] = [
      { visual_uri: clipA, audio_uri: null, duration_s: 2, caption: 'Real footage shot' },
      { visual_uri: null, audio_uri: null, duration_s: 2, caption: 'Placeholder slate shot' },
    ];
    const res = await renderEpisode({ episodeId: 'ut_basic', shots, outDir: join(work, 'ut_basic') });

    expect(existsSync(res.path)).toBe(true);
    expect(res.shots).toBe(2);
    expect(res.real).toBe(1);          // clipA resolves to a real local file
    expect(res.placeholders).toBe(1);  // null visual -> captioned slate
    expect(res.music).toBe(false);

    const info = probe(res.path);
    expect(info.video).toEqual({ codec: 'h264', width: 1280, height: 720 });
    expect(info.audio?.codec).toBe('aac');
    expect(info.duration).toBeGreaterThan(3); // ~2s + 2s
  }, 60_000);

  it('mixes in background music when a music uri is provided', async () => {
    const shots: RenderShot[] = [{ visual_uri: clipA, audio_uri: null, duration_s: 2, caption: 'With music' }];
    const res = await renderEpisode({ episodeId: 'ut_music', shots, musicUri: music, outDir: join(work, 'ut_music') });

    expect(res.music).toBe(true);
    const info = probe(res.path);
    expect(info.video?.width).toBe(1280);
    expect(info.audio?.codec).toBe('aac');
  }, 60_000);

  it('throws when given no shots', async () => {
    await expect(renderEpisode({ episodeId: 'ut_empty', shots: [], outDir: join(work, 'ut_empty') })).rejects.toThrow(/no shots/);
  });
});
