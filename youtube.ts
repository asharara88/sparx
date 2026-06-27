import { readFileSync, existsSync, statSync } from 'node:fs';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import type { ProviderInfo } from './types.js';

// YouTube upload provider. Real path = Data API v3 resumable upload (videos.insert):
//   1) POST .../upload/youtube/v3/videos?uploadType=resumable&part=snippet,status  -> Location URL
//   2) PUT the video bytes to that URL                                            -> video resource {id}
// Requires YOUTUBE_ACCESS_TOKEN (OAuth, scope youtube.upload) AND a real local
// video file. Otherwise falls back to a mock id. Privacy defaults to "private"
// — going public is a deliberate, separate step (never auto-published).
const log = createLogger({ mod: 'youtube' });

export interface UploadRequest {
  filePath?: string;            // local mp4 to upload (real path only)
  title: string;
  description: string;
  tags: string[];
  privacyStatus?: 'private' | 'unlisted' | 'public';
  madeForKids?: boolean;
}
export interface UploadResult { videoId: string; uploaded: boolean }
export interface YouTubeProvider extends ProviderInfo { upload(req: UploadRequest): Promise<UploadResult> }

class RealYouTube implements YouTubeProvider {
  readonly name = 'youtube'; readonly live = true;
  constructor(private token: string) {}

  async upload(req: UploadRequest): Promise<UploadResult> {
    const c = config();
    if (!req.filePath || !existsSync(req.filePath)) {
      // We have a token but no real rendered file yet (render step not run).
      log.warn('youtube token present but no real video file; recording metadata, skipping upload', { filePath: req.filePath });
      return { videoId: `pending_${Date.now()}`, uploaded: false };
    }
    const bytes = readFileSync(req.filePath);
    const size = statSync(req.filePath).size;
    const meta = {
      snippet: { title: req.title.slice(0, 100), description: req.description.slice(0, 5000), tags: req.tags.slice(0, 30), categoryId: c.YOUTUBE_CATEGORY_ID },
      status: { privacyStatus: req.privacyStatus ?? c.YOUTUBE_PRIVACY, selfDeclaredMadeForKids: req.madeForKids ?? false },
    };
    // 1) initiate resumable session
    const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': 'video/*',
        'X-Upload-Content-Length': String(size),
      },
      body: JSON.stringify(meta),
    });
    if (!init.ok) throw new Error(`YouTube init ${init.status}: ${(await init.text()).slice(0, 240)}`);
    const uploadUrl = init.headers.get('location');
    if (!uploadUrl) throw new Error('YouTube did not return a resumable upload URL');
    // 2) upload bytes
    const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'video/*', 'Content-Length': String(size) }, body: bytes });
    if (!put.ok) throw new Error(`YouTube upload ${put.status}: ${(await put.text()).slice(0, 240)}`);
    const data = (await put.json()) as { id: string };
    log.info('youtube upload complete', { videoId: data.id, privacy: meta.status.privacyStatus });
    return { videoId: data.id, uploaded: true };
  }
}

class MockYouTube implements YouTubeProvider {
  readonly name = 'mock'; readonly live = false;
  async upload(req: UploadRequest): Promise<UploadResult> {
    return { videoId: `mock_${Math.abs(hash(req.title))}`, uploaded: false };
  }
}
function hash(s: string) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }

let provider: YouTubeProvider | null = null;
export function getYouTube(): YouTubeProvider {
  if (provider) return provider;
  const c = config();
  provider = c.YOUTUBE_ACCESS_TOKEN ? new RealYouTube(c.YOUTUBE_ACCESS_TOKEN) : new MockYouTube();
  return provider;
}
export function __setYouTube(p: YouTubeProvider | null) { provider = p; }
export { RealYouTube };
