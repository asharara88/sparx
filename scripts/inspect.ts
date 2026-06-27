// Run the pipeline and print the resulting Episode State content. Dev tool.
import 'dotenv/config';
import { newEpisodeState } from '../src/types/episode.js';
import { Producer } from '../src/producer/producer.js';
import { config } from '../src/config.js';

const state = newEpisodeState('ep_inspect', { niche: config().CHANNEL_NICHE, host_mode: 'mixed' });
const f = await new Producer({ autoApproveGates: true }).run(state);

console.log('\n=== CONCEPT ===');
console.log('title :', f.concept.working_title);
console.log('angle :', f.concept.angle);
console.log('audience:', f.concept.audience);
console.log('thumb :', f.concept.thumbnail_concept);
console.log('scored:', f.concept.angle_candidates.map((a) => `${a.score}:${a.angle.slice(0, 40)}`).join('\n        '));
console.log('keywords:', f.concept.keywords.join(', '));
console.log('\n=== SCRIPT ===');
console.log('hook :', f.script.hook);
console.log('variants:', f.script.hook_variants.length, '| beats:', f.script.beat_sheet.length, '| sections:', f.script.sections.length, '| words:', f.script.word_count);
console.log('critique:', f.script.critique);
console.log('\n=== SHOTS ===');
for (const s of f.shot_list) console.log(`${s.shot_id} [${s.source}] $${s.cost_estimate_usd}  ${s.prompt.runway ? s.prompt.runway.slice(0, 70) : '(asset)'}`);
console.log('\nstatus:', f.status, '| est spend $' + f.shot_list.reduce((n, s) => n + s.cost_estimate_usd, 0).toFixed(2));
