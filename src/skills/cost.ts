// Deprecated shim — pricing truth now lives in src/skills/costModel.ts.
// Kept so existing imports keep compiling; new code should import costModel directly.
export { estimateShotCost, estimateAvatarCost, estimateImageCost, estimateVoiceCost, shouldThrottle } from './costModel.js';
