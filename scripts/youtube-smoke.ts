import 'dotenv/config';
import { existsSync, statSync } from 'node:fs';
import { renderEpisode, ffmpegAvailable } from '../src/media/render.js';
import { getYouTube } from '../src/media/youtube.js';
import { config } from '../src/config.js';

// MANUAL, OPT-IN live smoke test for the YouTube resumable upload path.
// It uploads ONE real mp4 as PRIVATE (never unlisted/public) so you can confirm the
// OAuth + videos.insert flow works end-to-end against the live API, then DELETE it.
//
// Nothing here runs unless you ask for it explicitly:
//   1) Provide OAuth creds in .env (YOUTUBE_CLIENT_ID/SECRET/REFRESH_TOKEN, or
//      YOUTUBE_ACCESS_TOKEN). With none set the YouTube provider is mock-only and
//      this script refuses to run.
//   2) Pass --confirm. Without it we stop after rendering, before any network call.
//
// Usage:
//   npx tsx scripts/youtube-smoke.ts --confirm                 # render a tiny clip + upload
//   npx tsx scripts/youtube-smoke.ts --confirm /path/to.mp4    # upload an existing mp4
//
// Privacy is FORCED to 'private' regardless of YOUTUBE_PRIVACY. There is no public path.

const args = process.argv.slice(2);
const confirmed = args.includes('--confirm');
const explicitPath = args.find((a) => !a.startsWith('--'));

async function main() {
  const yt = getYouTube();
  if (!yt.live) {
    console.error(
      '✗ YouTube provider is in MOCK mode (no OAuth creds). Set YOUTUBE_CLIENT_ID/' +
        'YOUTUBE_CLIENT_SECRET/YOUTUBE_REFRESH_TOKEN (or YOUTUBE_ACCESS_TOKEN) in .env first.\n' +
        '  No upload was attempted.',
    );
    process.exit(1);
  }

  // Resolve the file to upload: an existing mp4 you passed, or a freshly rendered slate.
  let filePath = explicitPath;
  if (filePath) {
    if (!existsSync(filePath)) { console.error(`✗ file not found: ${filePath}`); process.exit(1); }
  } else {
    if (!ffmpegAvailable()) { console.error('✗ ffmpeg not installed and no mp4 path given.'); process.exit(1); }
    console.log('• rendering a 3s placeholder slate to upload…');
    const res = await renderEpisode({
      episodeId: 'youtube_smoke',
      shots: [{ visual_uri: null, audio_uri: null, duration_s: 3, caption: 'SPARX upload smoke test — private, safe to delete' }],
    });
    filePath = res.path;
  }
  console.log(`• file ready: ${filePath} (${(statSync(filePath).size / 1024).toFixed(0)} KB)`);

  if (!confirmed) {
    console.log(
      '\nStopping BEFORE upload (no --confirm). Re-run with --confirm to actually upload\n' +
        'this file to YouTube as PRIVATE. Nothing was sent to the network.',
    );
    return;
  }

  console.log(`• uploading to YouTube as PRIVATE via "${yt.name}" provider…`);
  const result = await yt.upload({
    filePath,
    title: 'SPARX upload smoke test (private — delete me)',
    description: 'Automated private smoke test of the YouTube upload path. Safe to delete.',
    tags: ['sparx', 'smoke-test'],
    privacyStatus: 'private', // FORCED private; do not change.
    madeForKids: false,
  });

  if (result.uploaded) {
    console.log(`✓ uploaded PRIVATE video id=${result.videoId}`);
    console.log(`  → review: https://studio.youtube.com/video/${result.videoId}/edit  (then DELETE it)`);
  } else {
    console.log(`• provider returned uploaded=false (id=${result.videoId}); check creds/file. Privacy default=${config().YOUTUBE_PRIVACY}.`);
  }
}

main().catch((e) => { console.error('✗ smoke test failed:', e?.message ?? e); process.exit(1); });
