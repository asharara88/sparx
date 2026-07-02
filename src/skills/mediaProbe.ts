import { execFile, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { createLogger } from '../logger.js';
import { defineSkill } from './registry.js';

// ffprobe wrapper — real measured durations/streams instead of the words/2.3
// guesses that previously sized the music bed and chapter timestamps. Returns
// null (never throws) when the file is remote/missing or ffprobe is absent,
// so callers degrade to their estimate explicitly.

const exec = promisify(execFile);
const log = createLogger({ mod: 'media-probe' });

export interface MediaProbe {
  durationS: number;
  hasAudio: boolean;
  hasVideo: boolean;
  width: number;
  height: number;
  container: string;
}

let probeAvailable: boolean | null = null;
export function ffprobeAvailable(): boolean {
  if (probeAvailable !== null) return probeAvailable;
  try {
    probeAvailable = spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status === 0;
  } catch {
    probeAvailable = false;
  }
  return probeAvailable;
}

export async function probeMedia(uri: string): Promise<MediaProbe | null> {
  if (!uri || uri.includes('://') || !existsSync(uri)) return null; // local files only
  if (!ffprobeAvailable()) return null;
  try {
    const { stdout } = await exec('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', uri], { timeout: 15_000 });
    const data = JSON.parse(stdout) as {
      format?: { duration?: string; format_name?: string };
      streams?: { codec_type?: string; width?: number; height?: number }[];
    };
    const streams = data.streams ?? [];
    const video = streams.find((s) => s.codec_type === 'video');
    return {
      durationS: Number(data.format?.duration ?? 0) || 0,
      hasAudio: streams.some((s) => s.codec_type === 'audio'),
      hasVideo: video !== undefined,
      width: video?.width ?? 0,
      height: video?.height ?? 0,
      container: data.format?.format_name ?? '',
    };
  } catch (e) {
    log.warn('ffprobe failed', { uri, err: String(e).slice(0, 120) });
    return null;
  }
}

export const mediaProbeSkill = defineSkill<{ uri: string }, MediaProbe | null>({
  name: 'media-probe',
  description: 'Measure a local media file with ffprobe: duration, audio/video streams, resolution. Null for remote/missing files or when ffprobe is absent.',
  live: () => ffprobeAvailable(),
  run: async ({ uri }) => probeMedia(uri),
});
