import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { fetchWithRetry } from '../util/http.js';
import type { ProviderInfo } from './types.js';

// YouTube upload provider. Real path = Data API v3 resumable upload (videos.insert):
//   1) POST .../upload/youtube/v3/videos?uploadType=resumable&part=snippet,status  -> Location URL
//   2) PUT the video bytes (streamed, not buffered) to that URL                    -> video resource {id}
// Plus thumbnails.set and captions.insert for the packaging/captions artifacts.
// All calls go through fetchWithRetry (per-attempt timeout, transient-only retry).
// Requires YOUTUBE_ACCESS_TOKEN (OAuth, scope youtube.upload) AND a real local
// video file. Otherwise falls back to a mock id. Privacy defaults to "private"
// — going public is a deliberate, separate step (never auto-published).
const log = createLogger({ mod: 'youtube' });

// The bytes PUT of a full episode can legitimately take minutes; the default
// per-attempt HTTP timeout (30s) is tuned for API calls, not uploads.
const UPLOAD_TIMEOUT_MS = 15 * 60_000;

export interface UploadRequest {
  filePath?: string;            // local mp4 to upload (real path only)
  title: string;
  description: string;
  tags: string[];
  privacyStatus?: 'private' | 'unlisted' | 'public';
  madeForKids?: boolean;
  /** YouTube's altered/synthetic-media declaration (AI-disclosure compliance). */
  containsSyntheticMedia?: boolean;
}
export interface UploadResult { videoId: string; uploaded: boolean }
/** Result of a secondary asset upload (thumbnail / caption track). */
export interface AssetUploadResult { ref: string; uploaded: boolean }
export interface YouTubeProvider extends ProviderInfo {
  upload(req: UploadRequest): Promise<UploadResult>;
  uploadThumbnail(videoId: string, filePath: string): Promise<AssetUploadResult>;
  uploadCaptions(videoId: string, srtPath: string, language: string): Promise<AssetUploadResult>;
}

// A token source: either a fixed access token, or a refresher that exchanges a
// long-lived refresh token for short-lived access tokens (cached until expiry).
type TokenSource = () => Promise<string>;

function staticToken(token: string): TokenSource {
  return async () => token;
}

function refreshingToken(clientId: string, clientSecret: string, refreshToken: string): TokenSource {
  let cached: { token: string; expiresAt: number } | null = null;
  return async () => {
    // Reuse while >60s of life remains; otherwise mint a fresh one.
    if (cached && Date.now() < cached.expiresAt - 60_000) return cached.token;
    const res = await fetchWithRetry('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    }, { label: 'youtube.oauth' });
    const data = (await res.json()) as { access_token: string; expires_in: number };
    cached = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
    log.info('refreshed youtube access token', { expiresInS: data.expires_in });
    return cached.token;
  };
}

class RealYouTube implements YouTubeProvider {
  readonly name = 'youtube'; readonly live = true;
  constructor(private getToken: TokenSource) {}

  async upload(req: UploadRequest): Promise<UploadResult> {
    const c = config();
    if (!req.filePath || !existsSync(req.filePath)) {
      // We have a token but no real rendered file yet (render step not run).
      log.warn('youtube token present but no real video file; recording metadata, skipping upload', { filePath: req.filePath });
      return { videoId: `pending_${Date.now()}`, uploaded: false };
    }
    const token = await this.getToken();
    const size = statSync(req.filePath).size;
    const status: Record<string, unknown> = {
      privacyStatus: req.privacyStatus ?? c.YOUTUBE_PRIVACY,
      selfDeclaredMadeForKids: req.madeForKids ?? false,
    };
    // Altered/synthetic-content declaration — the real AI-disclosure label, not a
    // description footnote. Only set when the caller took an explicit position.
    if (req.containsSyntheticMedia !== undefined) status.containsSyntheticMedia = req.containsSyntheticMedia;
    const meta = {
      snippet: { title: req.title.slice(0, 100), description: req.description.slice(0, 5000), tags: req.tags.slice(0, 30), categoryId: c.YOUTUBE_CATEGORY_ID },
      status,
    };
    // 1) initiate resumable session (idempotent, safe to retry)
    const init = await fetchWithRetry('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': 'video/*',
        'X-Upload-Content-Length': String(size),
      },
      body: JSON.stringify(meta),
    }, { label: 'youtube.init' });
    const uploadUrl = init.headers.get('location');
    if (!uploadUrl) throw new Error('YouTube did not return a resumable upload URL');
    // 2) stream the bytes — no whole-file buffering. A consumed stream can't be
    // replayed, so the PUT itself gets no transparent retry (retries: 0); the
    // resumable session URL stays valid for a Producer-level re-run.
    const put = await fetchWithRetry(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'video/*', 'Content-Length': String(size) },
      body: Readable.toWeb(createReadStream(req.filePath)) as unknown as BodyInit,
      duplex: 'half',
    } as RequestInit, { label: 'youtube.upload', retries: 0, timeoutMs: Math.max(c.HTTP_TIMEOUT_MS, UPLOAD_TIMEOUT_MS) });
    const data = (await put.json()) as { id: string };
    log.info('youtube upload complete', { videoId: data.id, privacy: status.privacyStatus });
    return { videoId: data.id, uploaded: true };
  }

  async uploadThumbnail(videoId: string, filePath: string): Promise<AssetUploadResult> {
    if (!existsSync(filePath)) {
      log.warn('thumbnail file missing; skipping thumbnails.set', { videoId, filePath });
      return { ref: '', uploaded: false };
    }
    const token = await this.getToken();
    const contentType = filePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
    const res = await fetchWithRetry(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
      body: readFileSync(filePath), // thumbnails are ≤2MB; buffering is fine here
    }, { label: 'youtube.thumbnail' });
    const data = (await res.json()) as { items?: { default?: { url?: string } }[] };
    const ref = data.items?.[0]?.default?.url ?? videoId;
    log.info('youtube thumbnail set', { videoId });
    return { ref, uploaded: true };
  }

  async uploadCaptions(videoId: string, srtPath: string, language: string): Promise<AssetUploadResult> {
    if (!existsSync(srtPath)) {
      log.warn('caption file missing; skipping captions.insert', { videoId, srtPath });
      return { ref: '', uploaded: false };
    }
    const token = await this.getToken();
    // captions.insert needs snippet metadata + the track bytes → multipart/related.
    const boundary = `sparx_${Date.now().toString(36)}`;
    const snippet = JSON.stringify({ snippet: { videoId, language, name: language } });
    const body = [
      `--${boundary}`, 'Content-Type: application/json; charset=UTF-8', '', snippet,
      `--${boundary}`, 'Content-Type: application/octet-stream', '', readFileSync(srtPath, 'utf8'),
      `--${boundary}--`, '',
    ].join('\r\n');
    const res = await fetchWithRetry('https://www.googleapis.com/upload/youtube/v3/captions?part=snippet&uploadType=multipart', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    }, { label: 'youtube.captions' });
    const data = (await res.json()) as { id?: string };
    log.info('youtube caption track uploaded', { videoId, language });
    return { ref: data.id ?? videoId, uploaded: true };
  }
}

class MockYouTube implements YouTubeProvider {
  readonly name = 'mock'; readonly live = false;
  async upload(req: UploadRequest): Promise<UploadResult> {
    return { videoId: `mock_${Math.abs(hash(req.title))}`, uploaded: false };
  }
  async uploadThumbnail(videoId: string): Promise<AssetUploadResult> {
    return { ref: `mock://youtube/${videoId}/thumbnail`, uploaded: false };
  }
  async uploadCaptions(videoId: string, _srtPath: string, language: string): Promise<AssetUploadResult> {
    return { ref: `mock://youtube/${videoId}/captions/${language}`, uploaded: false };
  }
}
function hash(s: string) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }

let provider: YouTubeProvider | null = null;
export function getYouTube(): YouTubeProvider {
  if (provider) return provider;
  const c = config();
  if (c.YOUTUBE_CLIENT_ID && c.YOUTUBE_CLIENT_SECRET && c.YOUTUBE_REFRESH_TOKEN) {
    // Durable: refresh tokens auto-mint fresh access tokens — survives unattended runs.
    provider = new RealYouTube(refreshingToken(c.YOUTUBE_CLIENT_ID, c.YOUTUBE_CLIENT_SECRET, c.YOUTUBE_REFRESH_TOKEN));
  } else if (c.YOUTUBE_ACCESS_TOKEN) {
    // One-off: a static ~1h token, fine for manual tests.
    provider = new RealYouTube(staticToken(c.YOUTUBE_ACCESS_TOKEN));
  } else {
    provider = new MockYouTube();
  }
  return provider;
}
export function __setYouTube(p: YouTubeProvider | null) { provider = p; }
export { RealYouTube };
