import 'dotenv/config';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { getSupabase } from '../src/state/supabase.js';
import { claimJob, requeueStaleJobs, finishJob, updateJobLog, setJobEpisode, type RenderJob } from '../src/state/jobs.js';
import { uploadRender } from '../src/media/storage.js';
import { runEnvAndArgs } from '../src/producer/runParams.js';

// The always-on render worker (Railway). Vercel can only enqueue jobs; this process
// drains the queue: claim a job, run the SAME pipeline the CLI runs (spawned so its
// crashes never take the worker down), stream its log to the row, upload the cut to
// Supabase Storage, and mark the job done/failed. Runs forever; scale by running more.
const REPO_ROOT = new URL('..', import.meta.url).pathname;
const WORKER_ID = `${hostname()}#${process.pid}`;
const POLL_MS = 3000;
const LOG_FLUSH_MS = 2000;
const LOG_MAX = 12_000; // bounded tail kept in the row
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const sb = getSupabase();
if (!sb) {
  console.error('worker: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are required.');
  process.exit(1);
}

function runChild(job: RenderJob, onLog: (chunk: string) => void): Promise<number> {
  const { env: overrides, args } = runEnvAndArgs(job.mode, job.params);
  const env = { ...process.env, ...overrides } as NodeJS.ProcessEnv;
  return new Promise((resolve) => {
    const child = spawn('npx', args, { cwd: REPO_ROOT, env });
    child.stdout.on('data', (b) => onLog(b.toString()));
    child.stderr.on('data', (b) => onLog(b.toString()));
    child.on('error', (e) => { onLog(`\nworker spawn error: ${String(e)}\n`); resolve(1); });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function runJob(job: RenderJob): Promise<void> {
  console.log(`worker: claimed job ${job.id} (${job.mode})`);
  let buf = '';
  let episodeId: string | null = job.episode_id;
  let dirty = false;

  const onLog = (chunk: string) => {
    buf = (buf + chunk).slice(-LOG_MAX);
    dirty = true;
    // The pipeline logs "episode=ep_…" on start; capture it so the dashboard and
    // the stored cut key off the real episode id.
    if (!episodeId && job.mode === 'pipeline') {
      const m = buf.match(/episode=(ep_[A-Za-z0-9_]+)/);
      if (m) { episodeId = m[1]; setJobEpisode(sb!, job.id, episodeId).catch(() => {}); }
    }
  };

  // Flush the log tail to the row on a timer while the child runs.
  const flusher = setInterval(() => {
    if (!dirty) return;
    dirty = false;
    updateJobLog(sb!, job.id, buf).catch(() => {});
  }, LOG_FLUSH_MS);

  let code = 1;
  try {
    code = await runChild(job, onLog);
  } finally {
    clearInterval(flusher);
  }

  if (code !== 0) {
    await finishJob(sb!, job.id, { status: 'failed', log: buf, error: `run exited with code ${code}`, episode_id: episodeId });
    console.log(`worker: job ${job.id} failed (exit ${code})`);
    return;
  }

  // Locate the rendered cut. Demo → generated/demo/cut.mp4; pipeline → generated/<episode>/cut.mp4.
  const outDirId = job.mode === 'demo' ? 'demo' : (episodeId ?? '');
  const cut = outDirId ? join(REPO_ROOT, 'generated', outDirId, 'cut.mp4') : '';
  if (!cut || !existsSync(cut)) {
    // Completed but produced no file (e.g. a pipeline that held at a review gate).
    await finishJob(sb!, job.id, { status: 'done', log: buf, video_path: null, episode_id: episodeId });
    console.log(`worker: job ${job.id} done, no video`);
    return;
  }

  // Key the object by episode (pipeline, so the Library can find it) or job (demo).
  const objectPath = `${episodeId ?? job.id}.mp4`;
  try {
    await uploadRender(sb!, objectPath, cut);
    if (episodeId) await sb!.from('episodes').update({ video_path: objectPath }).eq('episode_id', episodeId);
    await finishJob(sb!, job.id, { status: 'done', log: buf, video_path: objectPath, episode_id: episodeId });
    console.log(`worker: job ${job.id} done → ${objectPath}`);
  } catch (e) {
    await finishJob(sb!, job.id, { status: 'failed', log: buf, error: `upload failed: ${String(e)}`, episode_id: episodeId });
    console.log(`worker: job ${job.id} upload failed: ${String(e)}`);
  }
}

async function main(): Promise<void> {
  console.log(`worker ${WORKER_ID} online; draining render_jobs…`);
  const requeued = await requeueStaleJobs(sb!).catch(() => 0);
  if (requeued) console.log(`worker: requeued ${requeued} stale job(s)`);
  for (;;) {
    let job: RenderJob | null = null;
    try { job = await claimJob(sb!, WORKER_ID); }
    catch (e) { console.error('worker: claim error', String(e)); }
    if (job) { try { await runJob(job); } catch (e) { console.error('worker: job error', String(e)); } }
    else await sleep(POLL_MS);
  }
}

main().catch((e) => { console.error('worker crashed', e); process.exit(1); });
