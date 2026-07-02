import 'dotenv/config';
import { config } from './config.js';
import { log } from './logger.js';
import { newEpisodeState, type EpisodeState } from './types/episode.js';
import { Producer, type GateDecision } from './producer/producer.js';
import { createStore } from './state/store.js';
import { getSupabase } from './state/supabase.js';
import { getLLM } from './llm/client.js';

// Pipeline entry point.
//   npm run dev                                   # new episode (topic ideated from the niche)
//   npm run dev -- "topic to cover"               # new episode seeded with a requested topic
//   npm run dev -- --resume <episode_id>          # continue a held episode (needs Supabase)
//   npm run dev -- --resume <id> --approve        # approve the gate it's held at, then continue
//   npm run dev -- --resume <id> --revise "notes" # send it back a stage with creator notes
//   npm run dev -- --resume <id> --reject         # reject at the gate (fails the episode)
// Each run decides at most ONE gate; the pipeline then holds at the next gate
// for the next review (set AUTO_APPROVE_GATES=true to run unattended).

interface CliArgs {
  topic: string;
  resume: string | null;
  decision: GateDecision | null;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { topic: '', resume: null, decision: null };
  const words: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--resume') args.resume = argv[++i] ?? null;
    else if (a === '--approve') args.decision = { action: 'approve' };
    else if (a === '--reject') args.decision = { action: 'reject' };
    else if (a === '--revise') args.decision = { action: 'revise', notes: argv[++i] ?? '' };
    else if (a === '--demo') continue; // legacy flag from `npm run demo`
    else words.push(a);
  }
  args.topic = words.join(' ').trim();
  if (args.decision?.action === 'revise' && !args.decision.notes) {
    throw new Error('--revise requires notes: --revise "what to change"');
  }
  if (args.decision && !args.resume) {
    throw new Error(`--${args.decision.action} only applies to a resumed episode (add --resume <episode_id>)`);
  }
  return args;
}

function freshEpisodeId(): string {
  const now = new Date();
  const d = now.toISOString().slice(0, 10).replace(/-/g, '_');
  const t = now.toISOString().slice(11, 19).replace(/:/g, '');
  return `ep_${d}_${t}`; // time suffix: same-day runs no longer overwrite each other
}

async function main() {
  const c = config();
  const args = parseArgs(process.argv.slice(2));
  const store = createStore();

  let state: EpisodeState;
  if (args.resume) {
    if (!getSupabase()) {
      throw new Error('--resume needs a persistent store: configure SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (the in-memory store cannot outlive a process)');
    }
    const loaded = await store.load(args.resume);
    if (!loaded) throw new Error(`episode '${args.resume}' not found in the state store`);
    state = loaded;
    log.info('resuming episode', { episode: state.episode_id, status: state.status, decision: args.decision?.action ?? '(none)' });
  } else {
    state = newEpisodeState(freshEpisodeId(), {
      niche: c.CHANNEL_NICHE, languages: ['en'], host_mode: c.HOST_MODE, cap_usd_month: c.BUDGET_CAP_USD,
    });
    if (args.topic) state.concept.topic = args.topic; // research treats a pre-seeded topic as the creator's request
  }

  const llm = getLLM();
  log.info('starting pipeline', {
    episode: state.episode_id,
    status: state.status,
    topic: args.topic || '(ideated)',
    store: getSupabase() ? 'supabase' : 'in-memory',
    llm: llm.live ? c.LLM_MODEL : 'mock',
    autoApproveGates: c.AUTO_APPROVE_GATES,
  });

  // The CLI decision applies to the FIRST gate this run reaches (the one the
  // episode is held at); later gates hold for the next review.
  let decisionSpent = false;
  const producer = new Producer({
    store,
    onGate: async (gate) => {
      if (args.decision && !decisionSpent) {
        decisionSpent = true;
        log.info('applying gate decision', { gate, action: args.decision.action });
        return args.decision;
      }
      return false; // hold for human review
    },
  });
  const final = await producer.run(state);

  log.info('pipeline finished', {
    status: final.status,
    spentUsd: Number(final.budget.spent_this_episode_usd.toFixed(4)),
    capUsd: final.budget.cap_usd_month,
    sections: final.script.sections.length,
    shots: final.shot_list.length,
    generated: final.generated_video.length,
    shorts: final.shorts.length,
    video: final.publish.youtube_video_id || '(none)',
    llmCostUsd: Number(getLLM().totalUsage().costUsd.toFixed(4)),
  });
  if (final.status === 'concept_review' || final.status === 'script_review' || final.status === 'cut_review') {
    log.info('held at a gate — decide with:', {
      approve: `npm run dev -- --resume ${final.episode_id} --approve`,
      revise: `npm run dev -- --resume ${final.episode_id} --revise "notes"`,
      reject: `npm run dev -- --resume ${final.episode_id} --reject`,
    });
  }
}

// Only run when executed as the entry point — tests import parseArgs without launching the pipeline.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((e) => { log.error('pipeline crashed', { error: String(e?.stack ?? e) }); process.exit(1); });
}
