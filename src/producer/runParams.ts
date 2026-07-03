import type { JobMode, JobParams } from '../state/jobs.js';

// Turn a queued job's params into the child-process env overrides + argv the worker
// spawns. Mirrors web/lib/run-params.ts (the local-dev spawn path) so a job runs
// identically whether triggered locally or drained from the cloud queue.
export function runEnvAndArgs(mode: JobMode, params: JobParams): { env: Record<string, string>; args: string[] } {
  const env: Record<string, string> = {};
  if (params.avatarId) env.HEYGEN_AVATAR_ID = params.avatarId;
  if (params.voiceId) env.ELEVENLABS_VOICE_ID = params.voiceId;
  if (params.avatarVoice) env.AVATAR_VOICE = params.avatarVoice;
  if (params.runwayTakes != null) env.RUNWAY_MAX_TAKES = String(params.runwayTakes);
  if (mode === 'demo') {
    env.DEMO_SECTIONS = String(params.sections ?? 3);
    if (params.demoMode) env.DEMO_MODE = params.demoMode;
    if (params.music) env.DEMO_MUSIC = 'true';
    return { env, args: ['tsx', 'scripts/demo.ts', params.topic ?? 'Three AI tools every creator should try'] };
  }
  env.AUTO_APPROVE_GATES = params.autoApprove ? 'true' : 'false';
  if (params.hostMode) env.HOST_MODE = params.hostMode;
  return { env, args: ['tsx', 'src/index.ts'] };
}
