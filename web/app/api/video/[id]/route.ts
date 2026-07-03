import { createReadStream, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { GENERATED_DIR } from '@/lib/paths';
import { getSupabase } from '@/lib/supabase';
import { signedVideoUrl } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Deployed: the cut lives in Supabase Storage, not on Vercel's ephemeral disk.
// Resolve id (episode slug or job uuid) → object path → short-lived signed URL,
// which the browser streams directly (range requests included). Returns null when
// there's no stored render, so the caller falls through to the local-disk path.
async function storageRedirect(id: string): Promise<Response | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const byEpisode = await sb.from('episodes').select('video_path').eq('episode_id', id).maybeSingle();
  let path = (byEpisode.data?.video_path as string | undefined) ?? undefined;
  if (!path) {
    const byJob = await sb.from('render_jobs').select('video_path').eq('id', id).maybeSingle();
    path = (byJob.data?.video_path as string | undefined) ?? undefined;
  }
  if (!path) return null;
  const url = await signedVideoUrl(sb, path);
  if (!url) return null;
  return new Response(null, { status: 307, headers: { Location: url, 'Cache-Control': 'private, no-cache' } });
}

// Wrap a Node read stream as a web ReadableStream with safe teardown: browsers
// cancel video requests constantly (seeking, closing), which otherwise throws
// "Controller is already closed" as an uncaughtException. cancel() destroys the
// underlying stream and every controller op is guarded.
function fileToWebStream(file: string, start: number, end: number): ReadableStream<Uint8Array> {
  const node = createReadStream(file, { start, end });
  return new ReadableStream<Uint8Array>({
    start(controller) {
      node.on('data', (chunk) => {
        try { controller.enqueue(chunk as Uint8Array); }
        catch { node.destroy(); }
      });
      node.on('end', () => { try { controller.close(); } catch { /* already closed */ } });
      node.on('error', (err) => { try { controller.error(err); } catch { /* already torn down */ } });
    },
    cancel() { node.destroy(); },
  });
}

// Stream generated/<id>/cut.mp4 with HTTP range support (so the browser can seek).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Guard against path traversal: episode ids are simple slugs / job uuids.
  if (!/^[A-Za-z0-9._-]+$/.test(id)) return new Response('bad id', { status: 400 });

  // Prefer the stored render (deployed); fall through to local disk (dev).
  const redirect = await storageRedirect(id).catch(() => null);
  if (redirect) return redirect;

  const file = join(GENERATED_DIR, id, 'cut.mp4');
  if (!existsSync(file)) return new Response('not found', { status: 404 });

  const { size, mtimeMs } = statSync(file);
  // no-cache + ETag: the player remounts on every view switch, so let each mount
  // revalidate cheaply (304) instead of re-downloading the whole mp4 — while a
  // re-rendered cut under the same id (new mtime) still busts the cache.
  const etag = `"${size}-${Math.floor(mtimeMs)}"`;
  const cacheHeaders = { ETag: etag, 'Cache-Control': 'private, no-cache' };
  if (req.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { ...cacheHeaders, 'Accept-Ranges': 'bytes' } });
  }
  const range = req.headers.get('range');

  // bytes=N-M / bytes=N- / bytes=-N (suffix: last N bytes — players probe the
  // trailing moov atom this way). Clamp to the file and 416 anything unsatisfiable;
  // an unclamped end would advertise a Content-Length the stream never delivers.
  // Multi-range ("bytes=0-1,5-9") or malformed headers don't match the regex:
  // RFC 9110 lets a server ignore a Range it can't honor, so those fall through
  // to the full 200 below instead of failing a satisfiable request with 416.
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
  if (m && (m[1] || m[2])) {
    let start: number;
    let end: number;
    if (m[1]) {
      start = parseInt(m[1], 10);
      end = m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1;
    } else {
      start = Math.max(0, size - parseInt(m[2]!, 10));
      end = size - 1;
    }
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }
    return new Response(fileToWebStream(file, start, end), {
      status: 206,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(end - start + 1),
        ...cacheHeaders,
      },
    });
  }

  return new Response(fileToWebStream(file, 0, size - 1), {
    headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(size), 'Accept-Ranges': 'bytes', ...cacheHeaders },
  });
}
