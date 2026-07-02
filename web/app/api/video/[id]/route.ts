import { createReadStream, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { GENERATED_DIR } from '@/lib/paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  // Guard against path traversal: episode ids are simple slugs.
  if (!/^[A-Za-z0-9._-]+$/.test(id)) return new Response('bad id', { status: 400 });

  const file = join(GENERATED_DIR, id, 'cut.mp4');
  if (!existsSync(file)) return new Response('not found', { status: 404 });

  const size = statSync(file).size;
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
      },
    });
  }

  return new Response(fileToWebStream(file, 0, size - 1), {
    headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(size), 'Accept-Ranges': 'bytes' },
  });
}
