import type { JobMode, JobParams } from './jobs';

interface RunBody {
  mode?: string; topic?: string; sections?: number; demoMode?: string; autoApprove?: boolean;
  avatarId?: string; hostMode?: string; voiceId?: string; avatarVoice?: string; runwayTakes?: number; music?: boolean;
}

// Normalize + validate the dashboard's run request into a mode + a clean JobParams.
// One source of truth for both the enqueue path and the local-spawn path; the worker
// mirrors the env/args mapping in src/producer/runParams.ts.
export function normalizeRunBody(body: RunBody): { mode: JobMode; params: JobParams } {
  const mode: JobMode = body.mode === 'demo' ? 'demo' : 'pipeline';
  const params: JobParams = {};
  if (body.avatarId && /^[A-Za-z0-9._-]+$/.test(body.avatarId)) params.avatarId = body.avatarId;
  if (body.voiceId && /^[A-Za-z0-9._-]+$/.test(body.voiceId)) params.voiceId = body.voiceId;
  if (body.avatarVoice === 'elevenlabs' || body.avatarVoice === 'heygen') params.avatarVoice = body.avatarVoice;
  if (body.runwayTakes != null && Number.isFinite(Number(body.runwayTakes))) {
    params.runwayTakes = Math.max(1, Math.min(4, Math.round(Number(body.runwayTakes))));
  }
  if (mode === 'demo') {
    params.topic = (body.topic ?? '').toString().slice(0, 300) || 'Three AI tools every creator should try';
    params.sections = Math.max(1, Math.min(6, Number(body.sections) || 3));
    if (['avatar', 'voiceover', 'broll'].includes(body.demoMode ?? '')) params.demoMode = body.demoMode;
    if (body.music) params.music = true;
  } else {
    params.autoApprove = !!body.autoApprove;
    if (body.hostMode === 'avatar' || body.hostMode === 'voice_only') params.hostMode = body.hostMode;
  }
  return { mode, params };
}

// Turn JobParams into the child-process env overrides + argv for a local run.
// The child's dotenv won't override an already-set process env var, so these win.
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
