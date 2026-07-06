// Per-tool prompt adapters (§10a) — versioned, NOT hard-coded syntax.
//
// Findings → generation parameters, mapped to each tool's convention:
//   • ElevenLabs (the in-repo provider): natural-language prompt + a music_v2
//     composition plan (styles in positive/negative arrays, structure+lyrics in
//     chunk text) + force_instrumental + model_id.
//   • Suno: a Style field (global sound; genre front-loaded) SEPARATE from a
//     Lyrics field (structure meta-tags + parenthetical ad-libs). Structure tags
//     in Style are ignored; numeric/percentage tags are placebo.
//   • Udio: prompt + lyrics with a "verify current syntax" caveat, since Udio's
//     meta-tag/vocal conventions differ and change often.
//
// Descriptive words beat numeric tags in every tool — so BPM is emitted
// descriptively ("slow, ~60–70 BPM") and never as a machine parameter Suno/Udio
// would ignore.

import type {
  ElevenLabsPrompt,
  Goal,
  LyricPlan,
  ParameterPlan,
  SunoPrompt,
  TempoBand,
  ToolPrompt,
  UdioPrompt,
} from './types.js';

const GENRE_FOR_GOAL: Record<Goal, string> = {
  sleep: 'lullaby',
  feeding: 'lullaby',
  calm: 'gentle lullaby',
  play: 'upbeat nursery rhyme',
  focus: 'educational kids song',
  entertain: "playful children's song",
};

const MOOD_FOR_GOAL: Record<Goal, string[]> = {
  sleep: ['soothing', 'calming', 'warm'],
  feeding: ['gentle', 'steady', 'calming'],
  calm: ['gentle', 'reassuring', 'warm'],
  play: ['playful', 'bright', 'joyful'],
  focus: ['clear', 'warm', 'focused'],
  entertain: ['fun', 'joyful', 'singable'],
};

const EL_MIN_MS = 3_000;
const EL_MAX_MS = 600_000;
const CHUNK_MIN_MS = 3_000;
const CHUNK_MAX_MS = 120_000;

function dedupe(xs: string[]): string[] {
  return [...new Set(xs.map((s) => s.trim()).filter(Boolean))];
}

function tempoPhrase(band: TempoBand, plan: ParameterPlan): string {
  const tempoChoice = plan.choices.find((c) => c.key === 'tempo');
  const words = tempoChoice ? tempoChoice.descriptors.slice(0, 2).join(', ') : 'moderate';
  return `${words} (~${band.minBpm}–${band.maxBpm} BPM)`;
}

/** Positive/negative style descriptors gathered across every parameter choice,
 *  front-loaded with genre + mood as the tools prefer. */
function collectStyles(goal: Goal, plan: ParameterPlan): { positive: string[]; negative: string[] } {
  const positive = dedupe([
    GENRE_FOR_GOAL[goal],
    ...MOOD_FOR_GOAL[goal],
    ...plan.choices.flatMap((c) => c.descriptors),
  ]);
  const negative = dedupe(plan.choices.flatMap((c) => c.avoid));
  return { positive, negative };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Partition total length across N sections so the chunks SUM to totalMs, each
 *  within the chunk bounds. The remainder rides on the last chunk. Callers must
 *  pass a totalMs that already fits N chunks at the floor (see planLength). */
function chunkDurations(totalMs: number, n: number): number[] {
  if (n <= 0) return [];
  const each = clamp(Math.floor(totalMs / n), CHUNK_MIN_MS, CHUNK_MAX_MS);
  const durs = Array.from({ length: n }, () => each);
  const remainder = totalMs - each * n;
  if (remainder > 0) durs[n - 1] = clamp(each + remainder, CHUNK_MIN_MS, CHUNK_MAX_MS);
  return durs;
}

/** The length the composition plan will actually declare: the requested length,
 *  grown so N chunks fit at the 3s floor (otherwise floored chunks would sum to
 *  2–3× the requested length), capped at the provider ceiling. */
function planLength(requestedMs: number, n: number): number {
  return clamp(Math.max(requestedMs, n * CHUNK_MIN_MS), EL_MIN_MS, EL_MAX_MS);
}

// ── ElevenLabs ───────────────────────────────────────────────────────────────

export function toElevenLabs(input: { goal: Goal; plan: ParameterPlan; lyrics: LyricPlan; lengthMs: number }): ElevenLabsPrompt {
  const { goal, plan, lyrics } = input;
  const requestedMs = clamp(Math.round(input.lengthMs), EL_MIN_MS, EL_MAX_MS);
  const { positive, negative } = collectStyles(goal, plan);

  const vocalPhrase = lyrics.instrumental
    ? 'no vocals, instrumental'
    : `soft ${plan.stage === '2-3yr' || plan.stage === '3-4yr' || plan.stage === '4-6yr' ? 'warm' : 'infant-directed'} vocal`;

  const prompt = [
    GENRE_FOR_GOAL[goal],
    MOOD_FOR_GOAL[goal].join(', '),
    tempoPhrase(plan.tempo, plan),
    `${vocalPhrase}`,
    'seamless',
  ].join(', ');

  const base: ElevenLabsPrompt = {
    tool: 'elevenlabs',
    prompt,
    musicLengthMs: requestedMs,
    forceInstrumental: lyrics.instrumental,
    modelId: 'music_v2',
  };

  if (lyrics.instrumental || !lyrics.sections.length) return base;

  // Grow the declared length so the chunks partition it exactly (no 3s-floor
  // inflation) and keep the top-level length consistent with the plan.
  const planLen = planLength(requestedMs, lyrics.sections.length);
  base.musicLengthMs = planLen;
  const durs = chunkDurations(planLen, lyrics.sections.length);
  base.compositionPlan = {
    chunks: lyrics.sections.map((s, i) => ({
      // Section label + lyric text goes in `text`; broad style stays in styles.
      text: `${s.tag}\n${s.text}`,
      durationMs: durs[i] ?? CHUNK_MIN_MS,
      // First chunk sets the overall tone → 6–7 styles (SKILL.md guidance).
      positiveStyles: i === 0 ? positive.slice(0, 7) : positive.slice(0, 4),
      negativeStyles: negative.slice(0, 5),
      contextAdherence: 'high',
    })),
  };
  return base;
}

// ── Suno ─────────────────────────────────────────────────────────────────────

export function toSuno(input: { goal: Goal; plan: ParameterPlan; lyrics: LyricPlan }): SunoPrompt {
  const { goal, plan, lyrics } = input;
  const { positive, negative } = collectStyles(goal, plan);

  // Style field: front-load genre, then mood/tempo/instrumentation/vocal as
  // descriptive words. Structure tags are deliberately NOT here.
  const styleParts = [
    `${GENRE_FOR_GOAL[goal]}`,
    tempoPhrase(plan.tempo, plan),
    ...positive.slice(1, 8), // skip genre (already first)
    lyrics.instrumental ? 'instrumental' : 'soft close-mic vocal',
    negative.length ? `avoid: ${negative.slice(0, 5).join(', ')}` : '',
  ].filter(Boolean);

  // Lyrics field: structure meta-tags + text (or [Instrumental]).
  const lyricsField = lyrics.instrumental
    ? '[Instrumental]'
    : lyrics.sections.map((s) => `${s.tag}\n${s.text}`).join('\n\n');

  return {
    tool: 'suno',
    style: styleParts.join(', '),
    lyrics: lyricsField,
    caveats: [
      'Structure meta-tags ([Verse]/[Chorus]/[Outro]) belong in the Lyrics field ONLY — they are ignored in the Style field.',
      'Numeric/percentage tags (e.g. [Reverb:30%], exact BPM) are placebo — use descriptive words.',
      'Specify vocal gender in Style or it is randomized.',
      'Verify field conventions against current Suno docs — they are version-dependent.',
    ],
  };
}

// ── Udio ─────────────────────────────────────────────────────────────────────

export function toUdio(input: { goal: Goal; plan: ParameterPlan; lyrics: LyricPlan }): UdioPrompt {
  const { goal, plan, lyrics } = input;
  const { positive, negative } = collectStyles(goal, plan);
  const prompt = [
    GENRE_FOR_GOAL[goal],
    tempoPhrase(plan.tempo, plan),
    ...positive.slice(1, 8),
    lyrics.instrumental ? 'instrumental' : 'soft vocal',
    negative.length ? `not: ${negative.slice(0, 5).join(', ')}` : '',
  ].filter(Boolean).join(', ');

  return {
    tool: 'udio',
    prompt,
    lyrics: lyrics.instrumental ? '(instrumental)' : lyrics.sections.map((s) => `${s.tag}\n${s.text}`).join('\n\n'),
    caveats: [
      "Udio's prompt/structure/vocal-control conventions differ from Suno — verify against current Udio docs before use.",
      'Numeric/BPM parameters are unreliable — steer with descriptive words.',
    ],
  };
}

export function buildPrompts(input: { goal: Goal; plan: ParameterPlan; lyrics: LyricPlan; lengthMs: number }): Record<'elevenlabs' | 'suno' | 'udio', ToolPrompt> {
  return {
    elevenlabs: toElevenLabs(input),
    suno: toSuno(input),
    udio: toUdio(input),
  };
}
