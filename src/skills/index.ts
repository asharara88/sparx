// Skill registration hub. Importing this module registers every skill in the
// registry (side effect of each module's defineSkill call). The Producer and
// tests import it before validating agent skill declarations.

export { costModelSkill, estimateShotCost, estimateAvatarCost, estimateImageCost, estimateVoiceCost, shouldThrottle, PRICES } from './costModel.js';
export { referenceValidationSkill, validateRefs, type RefReport } from './referenceValidation.js';
export { artifactCacheSkill, cachedArtifact, contentKey, getCached, putCached } from './artifactCache.js';
export { channelMemorySkill, loadChannelMemory, saveChannelMemory, rememberEpisode, pastTopics, type ChannelMemory, type EpisodeMemory } from './channelMemory.js';
export { mediaProbeSkill, probeMedia, ffprobeAvailable, type MediaProbe } from './mediaProbe.js';
export { captioningSkill, writeCaptions, buildCues, chunkText, toSRT, toVTT, type CaptionSection, type CaptionCue, type CaptionResult } from './captioning.js';
export { brandComplianceSkill, checkCompliance, type ComplianceReport } from './brandCompliance.js';
export { evidenceRetrievalSkill, verifyClaim } from './evidenceRetrieval.js';
export { assetMatchingSkill, buildAssetQuery, rankAssets, type AssetCandidate, type RankedAsset } from './assetMatching.js';
export { videoClippingSkill, clipVertical, type ClipRequest, type ClipResult } from './videoClipping.js';
export { webResearchSkill, webResearch, type SearchResult } from './research/webSearch.js';
export { seoKeywordSkill, clusterKeywords, type SeoResult, type KeywordCluster } from './research/seo.js';
export { timelineSkill, buildTimeline, type Timeline, type TimelineEntry } from './timeline.js';
export { techSegmentSkill, decideMode, disclosureFor, requiredDisclosureLines, buildTechBrief, techClaimRules, TECH_SECTION_ID, TechCandidatesSchema, TechSignalsSchema } from './techSegment.js';

export { getSkill, hasSkill, listSkills, missingSkills } from './registry.js';
