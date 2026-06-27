import type { Agent } from './types.js';
import { research } from './research.js';
import { scriptwriter } from './scriptwriter.js';
import { visualDirector } from './visualDirector.js';
import { voiceover } from './voiceover.js';
import { videoGeneration } from './videoGeneration.js';
import { avatar } from './avatar.js';
import { assetSourcing } from './assetSourcing.js';
import { music } from './music.js';
import { editor } from './editor.js';
import { qa } from './qa.js';
import { shorts } from './shorts.js';
import { packaging } from './packaging.js';
import { publishing } from './publishing.js';

// Agent registry keyed by the names used in the state machine.
export const AGENTS: Record<string, Agent> = {
  research, scriptwriter, visual_director: visualDirector,
  voiceover, video_generation: videoGeneration, avatar, asset_sourcing: assetSourcing, music,
  editor, qa,
  shorts, packaging, publishing,
};
