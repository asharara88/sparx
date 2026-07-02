// Post-publish analytics run: pull performance for a published episode and fold
// it into channel memory for the next episode's research/packaging.
//   npx tsx scripts/analytics.ts <episode_id>
import 'dotenv/config';
import { createStore } from '../src/state/store.js';
import { AGENTS } from '../src/agents/index.js';
import * as budget from '../src/producer/budget.js';

const episodeId = process.argv[2];
if (!episodeId) {
  console.error('usage: npx tsx scripts/analytics.ts <episode_id>');
  process.exit(1);
}

const store = createStore();
const state = await store.load(episodeId);
if (!state) {
  console.error(`episode '${episodeId}' not found in the state store`);
  process.exit(1);
}

const result = await AGENTS.analytics_feedback!.run({
  episode_id: episodeId,
  agent: 'analytics_feedback',
  state,
  budget_remaining_usd: budget.remaining(state),
});

Object.assign(state, result.writes);
await store.save(state);
console.log(`analytics_feedback: ${result.status}${result.notes ? ` — ${result.notes}` : ''}`);
console.log(JSON.stringify(state.analytics, null, 2));
