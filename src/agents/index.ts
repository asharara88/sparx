import type { Agent } from './core.js';
import '../skills/index.js'; // register all skills before agents are validated
import { research } from './research.js';
import { scriptwriter } from './scriptwriter.js';
import { factChecker } from './factChecker.js';
import { visualDirector } from './visualDirector.js';
import { voiceover } from './voiceover.js';
import { videoGeneration } from './videoGeneration.js';
import { avatar } from './avatar.js';
import { assetSourcing } from './assetSourcing.js';
import { generationReconciler } from './generationReconciler.js';
import { music } from './music.js';
import { editor } from './editor.js';
import { render } from './render.js';
import { captions } from './captions.js';
import { renderQc } from './renderQc.js';
import { qa } from './qa.js';
import { shorts } from './shorts.js';
import { shortsRenderer } from './shortsRenderer.js';
import { packaging } from './packaging.js';
import { publishing } from './publishing.js';
import { analyticsFeedback } from './analyticsFeedback.js';

// Agent registry keyed by the names used in the state machine.
// analytics_feedback is registered but not in the machine — it runs post-publish
// via scripts/analytics.ts (or a scheduler) and feeds channel memory.
export const AGENTS: Record<string, Agent> = {
  research, scriptwriter, fact_checker: factChecker, visual_director: visualDirector,
  voiceover, video_generation: videoGeneration, avatar, asset_sourcing: assetSourcing,
  generation_reconciler: generationReconciler, music,
  editor, render, captions, render_qc: renderQc, qa,
  shorts, shorts_renderer: shortsRenderer, packaging, publishing,
  analytics_feedback: analyticsFeedback,
};
