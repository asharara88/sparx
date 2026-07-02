// Episode State types — the single shared data object (Build-Spec §4).
// Every agent reads/writes fields of EpisodeState; nothing else is shared.

export type EpisodeStatus =
  | 'draft'
  | 'researching'
  | 'concept_review'   // GATE A
  | 'scripting'
  | 'script_review'    // GATE B
  | 'generating'
  | 'assembling'
  | 'qa'
  | 'cut_review'       // GATE C
  | 'distributing'
  | 'published'
  | 'failed'
  | 'on_hold';

export type HostMode = 'real_face' | 'voice_only' | 'avatar' | 'mixed';
export type ShotSource = 'stock' | 'generated' | 'graphic' | 'avatar' | 'host';

export interface AngleCandidate { angle: string; score: number; why: string }

export interface Concept {
  topic: string;
  working_title: string;
  angle: string;
  rationale: string;
  audience: string;            // who this is for
  thumbnail_concept: string;   // 1-line visual idea for the thumbnail
  angle_candidates: AngleCandidate[]; // evaluated options (best is `angle`)
  keywords: string[];
  competitor_refs: string[];
  target_length_min: number;
  approved: boolean;
}

// Fixed tech-spotlight slot (health×tech). Auto-planned per episode by the
// tech_segment_planner; the MODE decision is deterministic (skills/techSegment)
// over LLM-extracted signals, and everything that drove it is kept on state
// (candidates + signals + decision_trace) as an audit trail. `sponsored` drives
// mandatory disclosure copy — a legal requirement when true, brand voice when false.
export type TechSegmentMode = 'spotlight' | 'explainer' | 'hybrid';

export interface TechCandidateEval { name: string; kind: 'product' | 'category'; relevance: number; why: string }

export interface TechSegmentSignals {
  specific_product_exists: boolean;
  gulf_available: boolean;
  claims_testable: boolean;
  regulatory_murky: boolean;
  category_or_concept: boolean;
}

export interface TechSegment {
  enabled: boolean;                 // false → pipeline behaves exactly as before
  mode: TechSegmentMode;
  topic: string;                    // the chosen tech item ("Oura Ring 4", "GLP-1 peptides")
  tie_in: string;                   // one line: why it belongs in THIS episode
  product: { name: string; category: string; gulf_availability: string } | null; // spotlight/hybrid
  candidates: TechCandidateEval[];  // options considered (audit trail)
  signals: TechSegmentSignals;      // rubric inputs (audit trail)
  decision_trace: string;           // human-readable why-this-mode
  sponsored: boolean;
  disclosure: { ar: string; en: string };
}

export interface ScriptSection {
  id: string;
  beat: string;               // role of this section in the arc (e.g. "open loop", "payoff")
  vo_text: string;
  shot_note: string;
  on_screen: string;
  retention_device: string;   // what keeps the viewer watching here
}

export interface Script {
  hook: string;
  hook_variants: string[];    // alternates for A/B
  beat_sheet: string[];       // high-level beats before drafting
  sections: ScriptSection[];
  cta: string;
  brand_voice_pass: boolean;
  critique: string;           // self-critique pass summary
  word_count: number;
  approved: boolean;
}

export interface Shot {
  shot_id: string;
  section_id: string;
  source: ShotSource;
  duration_s: number;
  prompt: { runway?: string; kling?: string; veo?: string; seed?: number };
  selected_asset: string | null;
  cost_estimate_usd: number;
}

export interface Voiceover {
  voice_id: string;
  clips: { section_id: string; audio_uri: string; duration_s: number }[];
  total_duration_s: number;
}

export interface AvatarClip {
  shot_id: string;
  avatar_id: string;
  video_uri: string;
  duration_s: number;
  cost_usd: number;
}

export interface GeneratedVideo {
  shot_id: string;
  model: 'runway' | 'kling' | 'veo';
  takes: string[];
  selected_uri: string;
  cost_usd: number;
}

export interface SourcedAsset {
  shot_id: string;
  type: 'stock' | 'image';
  uri: string;
  license: string;
  cost_usd: number;
}

export interface Music {
  track_uri: string;
  sfx: string[];
  license: string;
  cost_usd: number;
}

export interface Edit {
  timeline_uri: string;
  captioned: boolean;
  render_uri: string;
  duration_s: number;
  approved: boolean;
}

export type ClaimVerdict = 'supported' | 'unsupported' | 'uncertain';

export interface FactCheckClaim {
  claim: string;
  verdict: ClaimVerdict;
  source: string;      // best supporting/refuting URL ('' when none found)
  note: string;
}

export interface FactCheck {
  checked: boolean;
  claims: FactCheckClaim[];
  unsupported_count: number;
}

export interface Captions {
  srt_uri: string;
  vtt_uri: string;
  cue_count: number;
}

export interface RenderQC {
  checked: boolean;
  passed: boolean;
  duration_s: number;
  has_audio: boolean;
  width: number;
  height: number;
  issues: string[];
}

export interface Analytics {
  checked_at: string;
  views: number;
  impressions_ctr: number;
  avg_view_duration_s: number;
  notes: string[];
}

export interface QA {
  fact_checks: string[];
  license_checks: string[];
  brand_checks: string[];
  ai_disclosure_required: boolean;
  passed: boolean;
  blocking_issues: string[];
}

export interface Short {
  short_id: string;
  source_range_s: [number, number];
  render_uri: string;
  hook: string;
}

export interface Packaging {
  thumbnails: string[];
  titles: string[];
  descriptions: string[];
}

export interface Publish {
  youtube_video_id: string;
  uploaded: boolean;           // true only after a REAL upload (authoritative; never inferred from id shape)
  scheduled_at: string;
  tags: string[];
  chapters: string[];
  ai_label_applied: boolean;
  shorts_posted: string[];
}

export interface BudgetLedgerEntry {
  agent: string;
  cost_usd: number;
  at: string;
}

export interface Budget {
  cap_usd_month: number;
  spent_this_episode_usd: number;
  ledger: BudgetLedgerEntry[];
}

export interface HistoryEntry {
  at: string;
  agent: string;
  event: string;
}

export interface EpisodeState {
  episode_id: string;
  created_at: string;
  status: EpisodeStatus;
  channel: { niche: string; languages: string[]; host_mode: HostMode };
  concept: Concept;
  tech_segment: TechSegment;
  script: Script;
  shot_list: Shot[];
  voiceover: Voiceover;
  generated_video: GeneratedVideo[];
  avatar_clips: AvatarClip[];
  sourced_assets: SourcedAsset[];
  music: Music;
  edit: Edit;
  captions: Captions;
  render_qc: RenderQC;
  fact_check: FactCheck;
  qa: QA;
  analytics: Analytics;
  shorts: Short[];
  packaging: Packaging;
  publish: Publish;
  budget: Budget;
  history: HistoryEntry[];
}

/**
 * Fill fields missing from a persisted state (rows saved by older code predate
 * fact_check/captions/render_qc/analytics/publish.uploaded). Agents dereference
 * these unconditionally, so loads must normalize or old episodes fail on load.
 */
export function normalizeEpisodeState(raw: Partial<EpisodeState> & { episode_id: string }): EpisodeState {
  const defaults = newEpisodeState(raw.episode_id);
  const merged = { ...defaults, ...raw } as EpisodeState;
  merged.publish = { ...defaults.publish, ...(raw.publish ?? {}) };
  return merged;
}

export function newEpisodeState(
  episode_id: string,
  opts: { niche?: string; languages?: string[]; host_mode?: HostMode; cap_usd_month?: number } = {}
): EpisodeState {
  const now = new Date().toISOString();
  return {
    episode_id,
    created_at: now,
    status: 'draft',
    channel: {
      niche: opts.niche ?? '',
      languages: opts.languages ?? ['en'],
      host_mode: opts.host_mode ?? 'real_face',
    },
    concept: { topic: '', working_title: '', angle: '', rationale: '', audience: '', thumbnail_concept: '', angle_candidates: [], keywords: [], competitor_refs: [], target_length_min: 10, approved: false },
    tech_segment: { enabled: false, mode: 'explainer', topic: '', tie_in: '', product: null, candidates: [], signals: { specific_product_exists: false, gulf_available: false, claims_testable: false, regulatory_murky: false, category_or_concept: false }, decision_trace: '', sponsored: false, disclosure: { ar: '', en: '' } },
    script: { hook: '', hook_variants: [], beat_sheet: [], sections: [], cta: '', brand_voice_pass: false, critique: '', word_count: 0, approved: false },
    shot_list: [],
    voiceover: { voice_id: '', clips: [], total_duration_s: 0 },   // empty → voiceover agent falls back to config().ELEVENLABS_VOICE_ID
    generated_video: [],
    avatar_clips: [],
    sourced_assets: [],
    music: { track_uri: '', sfx: [], license: '', cost_usd: 0 },
    edit: { timeline_uri: '', captioned: false, render_uri: '', duration_s: 0, approved: false },
    captions: { srt_uri: '', vtt_uri: '', cue_count: 0 },
    render_qc: { checked: false, passed: false, duration_s: 0, has_audio: false, width: 0, height: 0, issues: [] },
    fact_check: { checked: false, claims: [], unsupported_count: 0 },
    qa: { fact_checks: [], license_checks: [], brand_checks: [], ai_disclosure_required: true, passed: false, blocking_issues: [] },
    analytics: { checked_at: '', views: 0, impressions_ctr: 0, avg_view_duration_s: 0, notes: [] },
    shorts: [],
    packaging: { thumbnails: [], titles: [], descriptions: [] },
    publish: { youtube_video_id: '', uploaded: false, scheduled_at: '', tags: [], chapters: [], ai_label_applied: false, shorts_posted: [] },
    budget: { cap_usd_month: opts.cap_usd_month ?? 500, spent_this_episode_usd: 0, ledger: [] },
    history: [],
  };
}
