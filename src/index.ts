import 'dotenv/config';
import { config } from './config.js';
import { log } from './logger.js';
import { newEpisodeState } from './types/episode.js';
import { Producer } from './producer/producer.js';
import { getSupabase } from './state/supabase.js';
import { getLLM } from './llm/client.js';

async function main() {
  const c = config();
  const episodeId = `ep_${new Date().toISOString().slice(0, 10).replace(/-/g, '_')}_demo`;
  const state = newEpisodeState(episodeId, {
    niche: c.CHANNEL_NICHE, languages: ['en'], host_mode: c.HOST_MODE, cap_usd_month: c.BUDGET_CAP_USD,
  });

  const llm = getLLM();
  log.info('starting pipeline', {
    episode: episodeId,
    store: getSupabase() ? 'supabase' : 'in-memory',
    llm: llm.live ? c.LLM_MODEL : 'mock',
    autoApproveGates: c.AUTO_APPROVE_GATES,
  });

  const producer = new Producer();
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
}

main().catch((e) => { log.error('pipeline crashed', { error: String(e?.stack ?? e) }); process.exit(1); });
