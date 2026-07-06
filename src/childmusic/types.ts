// Music & Early-Childhood-Development specialist — domain types.
//
// This subsystem turns a caregiver/product request ("a calming song for my
// 4-month-old") into a graded, safety-checked AI-music-generation brief. It is
// deliberately decoupled from the YouTube EpisodeState pipeline: nothing here
// writes episode state. It mirrors the sparx idiom instead — deterministic rule
// engines exported as pure functions and wrapped as registered skills, with a
// generative-within-constraints prompt composer on top.
//
// The organizing principle from the knowledge base: EVERY generation parameter
// and EVERY user-facing developmental claim is tied to an evidence grade, so the
// pipeline can surface the grade whenever a benefit is implied and can refuse to
// assert what the evidence does not support (cognitive/IQ or bilingual
// acceleration in particular).

/** Evidence-grade key (knowledge base footer). Ordered weakest→strongest for
 *  the two ends, with Contested/Debunked as qualitative flags rather than a
 *  point on the confidence line. */
export type EvidenceGrade =
  | 'Strong' //     converging RCT/meta-analytic + replicated
  | 'Moderate' //   consistent but heterogeneous or mostly correlational
  | 'Emerging' //   early/limited
  | 'Contested' //  conflicting high-quality evidence
  | 'Debunked'; //  refuted by meta-analysis

/** A citation for a graded claim. `verify` marks sources the KB itself flagged
 *  as unverifiable / conflicting (regional journals, dead DOIs). */
export interface Citation {
  ref: string; // e.g. "Partanen et al., 2013, PLOS ONE 8(10):e78946"
  note?: string;
  verify?: boolean;
}

/** A single evidence-graded claim from the review (§2). Used by the
 *  Evidence-Citation Grounder to attach grades to anything user-facing and to
 *  hard-block over-claims. */
export interface GradedClaim {
  id: string;
  domain: 'neural' | 'language' | 'cognition' | 'socioemotional' | 'safety';
  statement: string;
  grade: EvidenceGrade;
  sources: Citation[];
  /** When true, asserting this benefit to a user is a marketing/liability risk
   *  the grounder must block or force into a hedge (cognitive/bilingual). */
  overclaimRisk?: boolean;
}

// ── Request domain ───────────────────────────────────────────────────────────

/** What the caregiver wants the music to DO. Maps to a §6 protocol. */
export type Goal = 'sleep' | 'calm' | 'play' | 'feeding' | 'focus' | 'entertain';

/** Developmental content makes (hedged) developmental claims and is gated on
 *  stage-appropriateness; entertainment content makes no developmental claims
 *  and optimizes for engagement/singability (§7b). */
export type Intent = 'developmental' | 'entertainment';

/** Canonical developmental stages (§4 matrix). */
export type StageId =
  | 'prenatal'
  | '0-3mo'
  | '3-6mo'
  | '6-12mo'
  | '12-18mo'
  | '18-24mo'
  | '2-3yr'
  | '3-4yr'
  | '4-6yr';

/** A named sensitive/critical window (§4 key windows). */
export type SensitiveWindow =
  | 'beat-contour-innate' //     pitch/contour & beat present from birth
  | 'phoneme-narrowing' //       non-native phoneme discrimination declining, 6–12 mo
  | 'rhythm-enculturation' //    culture-specific meter locks ~12 mo (Hannon & Trehub)
  | 'mode-emotion-emerging'; //  major/minor → happy/sad, ~4–7 yr

/** BCP-47-ish language tags the pipeline understands; 'ar'/'en' are first-class
 *  because the KB is explicit about Arabic/English (evidence absent at rigor). */
export type LangTag = 'en' | 'ar' | string;

export interface ChildMusicRequest {
  /** Free-text ask ("help my newborn fall asleep") OR an explicit goal below. */
  text?: string;
  goal?: Goal;
  intent?: Intent;
  /** Child age in months (prenatal encoded as a small negative offset is NOT
   *  supported — use stage:'prenatal' or ageMonths:0 with prenatal:true). */
  ageMonths?: number;
  stage?: StageId;
  prenatal?: boolean;
  /** Target language(s) for lyrics. Order = priority; first is the primary
   *  (native-target) language within the narrowing window. */
  languages?: LangTag[];
  /** Delivery context, consumed by the safety gate. */
  delivery?: DeliveryContext;
  /** Desired clip length; clamped to the provider ceiling by the adapter. */
  lengthMs?: number;
}

/** How the audio will actually be played — drives the fail-closed safety gate. */
export interface DeliveryContext {
  /** Speaker placement. `crib`/`near-ear` is a hard block (§8). */
  speaker?: 'room' | 'crib' | 'near-ear' | 'headphones';
  /** Whether the caregiver intends continuous background play (masks caregiver
   *  talk — §8 caveat) vs a bounded wind-down. */
  continuous?: boolean;
  /** NICU / preterm context raises the conservatism of volume + requires a
   *  certified therapist for live work (§6 feeding, §8). */
  nicu?: boolean;
  /** Whether a caregiver is present to sing/co-regulate; recorded/AI audio is a
   *  supplement, not a replacement (§1, §9). */
  caregiverPresent?: boolean;
}

// ── Rule-engine outputs ──────────────────────────────────────────────────────

export interface GoalDecision {
  goal: Goal;
  intent: Intent;
  /** §6 protocol key selected for this goal. */
  protocol: ProtocolId;
  /** Human-readable decision trace (auditable, like techSegment.decideMode). */
  trace: string;
  /** true when the goal was inferred from free text rather than given. */
  inferred: boolean;
}

export type ProtocolId = 'lullaby' | 'calming' | 'play' | 'feeding' | 'focus' | 'entertainment';

/** Inclusive BPM band. */
export interface TempoBand {
  minBpm: number;
  maxBpm: number;
}

export interface StageProfile {
  stage: StageId;
  ageMonths: number | null; // null for a stage-only request
  label: string;
  capacities: string[];
  windows: SensitiveWindow[];
  /** Hard ceilings the parameter selector must respect. */
  allowedTempo: TempoBand;
  /** Max harmonic/structural complexity 1(simplest)–5. */
  maxComplexity: 1 | 2 | 3 | 4 | 5;
  /** Preferred vocal register for this stage. */
  vocalRegister: 'infant-directed' | 'natural';
  caveats: string[];
  /** Screen-vs-audio guidance line appropriate to the stage (§8). */
  screenNote: string;
}

/** One resolved generation parameter with its provenance grade (§5). */
export interface ParameterChoice {
  key: ParameterKey;
  /** The concrete value chosen for this brief. */
  value: string;
  /** Natural-language descriptors handed to the generator (§10a: descriptors
   *  beat numeric tags in both Suno and ElevenLabs). */
  descriptors: string[];
  /** Descriptors to steer away from (negative styles). */
  avoid: string[];
  effect: string;
  grade: EvidenceGrade;
  /** BPM band when this choice is a tempo choice. */
  tempo?: TempoBand;
}

export type ParameterKey =
  | 'tempo'
  | 'meter'
  | 'repetition'
  | 'contour'
  | 'pitch'
  | 'consonance'
  | 'dynamics'
  | 'timbre'
  | 'vocal'
  | 'delivery'
  | 'mode'
  | 'lyric-language';

export interface ParameterPlan {
  goal: Goal;
  stage: StageId;
  choices: ParameterChoice[];
  /** Overall band actually used (post stage-clamp), for the adapters. */
  tempo: TempoBand;
  /** true when a requested/protocol tempo was clamped down by the stage ceiling. */
  tempoClamped: boolean;
  notes: string[];
}

// ── Evidence grounding ───────────────────────────────────────────────────────

export interface GroundedClaim {
  /** The claim as it would be surfaced to the user. */
  claim: string;
  grade: EvidenceGrade;
  sources: Citation[];
  /** false when the claim must NOT be asserted (blocked over-claim). */
  allowed: boolean;
  /** A safe, hedged rewrite when the raw claim is blocked or over-stated. */
  rewrite?: string;
  reason?: string;
}

// ── Safety gate ──────────────────────────────────────────────────────────────

export interface SafetyReport {
  passed: boolean;
  /** Hard, non-overridable violations. A non-empty list fails the brief. */
  blocks: string[];
  /** Advisory cautions surfaced to the caregiver but not blocking. */
  warnings: string[];
  /** Concrete, positive guidance (dB target, wind-down, audio≠screen). */
  guidance: string[];
}

// ── Lyrics ───────────────────────────────────────────────────────────────────

export interface LyricSection {
  /** Structural label used verbatim in the generator's lyric field. */
  tag: string; // [Intro] [Verse] [Chorus] [Outro] ...
  /** Draft text (may be empty for instrumental). */
  text: string;
  lang: LangTag;
}

export interface LyricPlan {
  instrumental: boolean;
  sections: LyricSection[];
  /** Per-language guidance actually applied (native-target prioritization,
   *  no within-line code-mixing, etc. — §7). */
  guidance: string[];
  /** The languages present, in priority order. */
  languages: LangTag[];
}

// ── Tool adapters (§10a) ─────────────────────────────────────────────────────

export type MusicTool = 'elevenlabs' | 'suno' | 'udio';

/** A structured chunk for ElevenLabs music_v2 composition plans. */
export interface CompositionChunk {
  text: string;
  durationMs: number;
  positiveStyles: string[];
  negativeStyles: string[];
  contextAdherence: 'low' | 'medium' | 'high';
}

export interface ElevenLabsPrompt {
  tool: 'elevenlabs';
  prompt: string;
  musicLengthMs: number;
  forceInstrumental: boolean;
  modelId: 'music_v2';
  compositionPlan?: { chunks: CompositionChunk[] };
}

export interface SunoPrompt {
  tool: 'suno';
  /** Global sound → Style Prompt field (front-loaded genre/mood/instr/vocal). */
  style: string;
  /** Structure meta-tags + lyrics → Lyrics field ONLY (never Style). */
  lyrics: string;
  /** Verify-at-build-time flags. */
  caveats: string[];
}

export interface UdioPrompt {
  tool: 'udio';
  prompt: string;
  lyrics: string;
  caveats: string[];
}

export type ToolPrompt = ElevenLabsPrompt | SunoPrompt | UdioPrompt;

// ── The specialist's output ──────────────────────────────────────────────────

export interface ChildMusicBrief {
  /** 'ok' when generation is cleared; 'blocked' when the safety gate fails —
   *  the brief still carries its diagnostics so callers can explain the block. */
  status: 'ok' | 'blocked';
  request: NormalizedRequest;
  goal: GoalDecision;
  stage: StageProfile;
  parameters: ParameterPlan;
  lyrics: LyricPlan;
  /** Every developmental benefit implied by this brief, graded and (where
   *  necessary) blocked/hedged. Empty for pure entertainment. */
  claims: GroundedClaim[];
  safety: SafetyReport;
  /** Ready-to-use prompts per tool. Present even when blocked so a caller can
   *  show what WOULD be generated, but callers must honor status. */
  prompts: Record<MusicTool, ToolPrompt>;
  /** One-line provenance summary: goal, stage, dominant grade. */
  summary: string;
}

/** The request after defaults + inference are applied (echoed for traceability). */
export interface NormalizedRequest {
  goal: Goal;
  intent: Intent;
  stage: StageId;
  ageMonths: number | null;
  prenatal: boolean;
  languages: LangTag[];
  delivery: Required<Pick<DeliveryContext, 'speaker' | 'continuous' | 'nicu' | 'caregiverPresent'>>;
  lengthMs: number;
}
