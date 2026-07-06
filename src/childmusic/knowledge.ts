// Evidence-graded knowledge base for the Music & Early-Childhood specialist.
//
// This is the single source of truth distilled from the research review. Every
// downstream rule engine reads from here; nothing hard-codes a claim, a tempo,
// or a grade inline. When the evidence changes, it changes HERE and the whole
// pipeline moves with it (the same discipline as costModel.PRICES).
//
// Traceability contract: each generation parameter (§5) and each user-facing
// claim (§2) carries an EvidenceGrade, so the specialist can surface the grade
// whenever a developmental benefit is implied.

import type {
  Citation,
  EvidenceGrade,
  Goal,
  GradedClaim,
  ParameterKey,
  ProtocolId,
  SensitiveWindow,
  StageId,
  TempoBand,
} from './types.js';

// ── §2 Graded claims ─────────────────────────────────────────────────────────
// The claims the Evidence-Citation Grounder attaches to briefs and gates on.
// `overclaimRisk: true` marks the claims a product must never assert as fact.

export const GRADED_CLAIMS: GradedClaim[] = [
  {
    id: 'arousal-regulation',
    domain: 'socioemotional',
    statement: 'Infant-directed singing regulates infant arousal — calming with lullabies, sustaining engagement with playsongs.',
    grade: 'Strong', // Strong for LIVE singing
    sources: [
      { ref: 'Shenfield, Trehub & Nakata, 2003, Psychology of Music 31:365' },
      { ref: 'Cirelli, Jurewicz & Trehub, 2019, PubMed 30912725' },
      { ref: 'Rock, Trainor & Addison, 1999, Developmental Psychology 35:527' },
    ],
  },
  {
    id: 'lullaby-calming-recorded',
    domain: 'socioemotional',
    statement: 'Lullaby-type acoustics (slow tempo, smooth contour, repetition, low dynamics) relax infants even when unfamiliar and recorded.',
    grade: 'Moderate', // cross-cultural; Strong for live, Moderate for recorded
    sources: [
      { ref: 'Bainbridge, Bertolo, Mehr et al., 2021, Nature Human Behaviour 5:256, DOI 10.1038/s41562-020-00963-z' },
    ],
  },
  {
    id: 'id-singing-preference',
    domain: 'socioemotional',
    statement: 'Infants prefer and attend more to infant-directed singing (higher pitch, slower tempo, exaggerated affect) than to spoken or instrumental delivery.',
    grade: 'Strong',
    sources: [
      { ref: 'Nakata & Trehub, 2004; 2011' },
    ],
  },
  {
    id: 'bonding',
    domain: 'socioemotional',
    statement: 'Caregiver singing supports mother–infant bonding and stress regulation.',
    grade: 'Strong', // Strong for live; Moderate for recorded
    sources: [
      { ref: 'Fancourt & Perkins, 2018' },
      { ref: 'Loewy, 2015, Ann NY Acad Sci 1337:178 ("song of kin")' },
    ],
  },
  {
    id: 'nicu-music-therapy',
    domain: 'socioemotional',
    statement: 'NICU music therapy with certified therapists (live entrained lullabies) improves heart/respiratory rate, feeding/sucking, quiet-alert states, and parent stress.',
    grade: 'Moderate', // meta-analytically supported but heterogeneous
    sources: [
      { ref: 'Loewy, Stewart, Dassler, Telsey & Homel, 2013, Pediatrics 131:902' },
      { ref: 'Bieleninik, Ghetti & Gold, 2016, Pediatrics 138:e20160971' },
      { ref: 'Chorna et al., 2014, Pediatrics 133:462 (pacifier-activated lullaby)' },
    ],
  },
  {
    id: 'beat-perception-innate',
    domain: 'neural',
    statement: 'Beat/meter and pitch-contour perception are present at or near birth.',
    grade: 'Strong',
    sources: [
      { ref: 'Winkler, Háden, Ladinig, Sziller & Honing, 2009, PNAS 106:2468' },
      { ref: 'Edalati et al., 2023, J Neurosci 43:2794' },
    ],
  },
  {
    id: 'prenatal-auditory-learning',
    domain: 'neural',
    statement: 'Third-trimester melody/voice exposure produces measurable neonatal neural responses, with a dose–response to prenatal exposure.',
    grade: 'Moderate', // Strong for existence; Moderate for magnitude/durability
    sources: [
      { ref: 'Partanen, Kujala, Tervaniemi & Huotilainen, 2013, PLOS ONE 8(10):e78946' },
      { ref: 'Partanen et al., 2013, PNAS 110:15145' },
      { ref: 'Ribas-Prats/Arenillas et al., 2024, Developmental Science, DOI 10.1111/desc.13362' },
      { ref: 'Hepper, 1991 (preference diminishes by ~21 days — memory trace short-lived)', note: 'durability caveat' },
    ],
  },
  {
    id: 'statistical-learning',
    domain: 'language',
    statement: 'Infants extract word/tone boundaries from transitional probabilities; repetition and predictable structure in songs feed this statistical learning.',
    grade: 'Strong',
    sources: [
      { ref: 'Saffran, Aslin & Newport, 1996, Science 274:1926' },
      { ref: 'Saffran et al., 1999, Cognition (tone sequences)' },
    ],
  },
  {
    id: 'perceptual-narrowing',
    domain: 'language',
    statement: 'Between ~6 and 12 months infants lose non-native phoneme discrimination while sharpening native contrasts — the key window for target-language exposure.',
    grade: 'Strong',
    sources: [
      { ref: 'Kuhl; Werker & Tees' },
      { ref: 'Bosseler et al., 2016, J Neurosci 36:12095' },
      { ref: 'Hannon & Trehub, 2005, Psychological Science (rhythm enculturation ~12 mo)' },
    ],
  },
  {
    id: 'rhythm-reading-link',
    domain: 'language',
    statement: 'Rhythm perception/production correlates with, and modestly predicts, phonological awareness and later reading.',
    grade: 'Moderate', // correlational + some clinical RCTs; reading is years downstream
    sources: [
      { ref: 'Anvari, Trainor, Woodside & Levy, 2002' },
      { ref: 'Ozernov-Palchik et al., 2018' },
      { ref: 'Flaugnacco et al., 2015, PLOS ONE, DOI 10.1371/journal.pone.0138715 (dyslexia RCT)' },
    ],
  },
  {
    id: 'vocab-via-song',
    domain: 'language',
    statement: 'Songs raise attention/engagement but do NOT reliably beat speech for deep vocabulary learning.',
    grade: 'Contested',
    sources: [
      { ref: 'Morini & Blair, 2021, Frontiers in Psychology, DOI 10.3389/fpsyg.2021.702819' },
    ],
  },
  {
    id: 'bilingual-exposure',
    domain: 'language',
    statement: 'Bilingual proficiency tracks the quantity and quality of input and the number of speakers (a meaningful minimum share of rich exposure is needed).',
    grade: 'Strong',
    sources: [
      { ref: 'Hoff, Core, Place et al., 2012, J Child Language 39:1' },
      { ref: 'Place & Hoff, 2011, Child Development 82:1834' },
      { ref: 'Byers-Heinlein synthesis, PMC8866745' },
    ],
  },
  {
    id: 'music-accelerates-bilingual',
    domain: 'language',
    statement: 'Songs specifically accelerate second-language / bilingual acquisition.',
    grade: 'Contested', // Emerging/Contested and methodologically weak; best-controlled preschool study found songs INFERIOR to stories
    overclaimRisk: true,
    sources: [
      { ref: 'Hamilton, Schulz, Chalmers & Murphy, 2024, System 124:103350 (systematic review: only 3/60 "strong")' },
      { ref: 'Albaladejo, Coyle & Roca de Larios, 2018, System 76:116 (Story > Song for vocabulary)' },
    ],
  },
  {
    id: 'arabic-english-music',
    domain: 'language',
    statement: 'Music/songs accelerate Arabic–English acquisition in 0–6-year-olds.',
    grade: 'Emerging', // essentially ABSENT at rigor — only attitudinal surveys / older-age regional work
    overclaimRisk: true,
    sources: [
      { ref: 'No rigorous RCT on Arabic–English 0–6 children and music/songs exists', verify: true },
    ],
  },
  {
    id: 'mozart-effect',
    domain: 'cognition',
    statement: 'Listening to Mozart (or classical music) raises a baby’s IQ or general intelligence.',
    grade: 'Debunked',
    overclaimRisk: true,
    sources: [
      { ref: 'Chabris, 1999, Nature (meta-analysis, d≈0.09)' },
      { ref: 'Oberleiter & Pietschnig, 2023, Scientific Reports 13, DOI 10.1038/s41598-023-30206-w' },
    ],
  },
  {
    id: 'music-training-transfer',
    domain: 'cognition',
    statement: 'Music training produces broad cognitive/academic transfer.',
    grade: 'Contested', // near-null in best-controlled meta-analyses; small inhibitory-control effects survive; pertains to ACTIVE training ages 3–12, not infant listening
    overclaimRisk: true,
    sources: [
      { ref: 'Sala & Gobet, 2020, Memory & Cognition 48:1429 (near-null, g≈0.06)' },
      { ref: 'Román-Caballero et al., 2022 (g≈0.28, strongest for inhibition)' },
    ],
  },
  {
    id: 'passive-listening-brain',
    domain: 'neural',
    statement: 'Passive recorded-music listening changes infant brain structure.',
    grade: 'Emerging', // not established in infants; no RCT-grade evidence
    overclaimRisk: true,
    sources: [{ ref: 'No RCT-grade infant evidence; rodent work (Kim et al., 2013) not translatable', verify: true }],
  },
  {
    id: 'long-term-language-transfer',
    domain: 'language',
    statement: 'Infant-directed singing improves long-term (e.g. 24-month) language outcomes.',
    grade: 'Contested', // LongSTEP RCT found NO significant 24-month language benefit
    overclaimRisk: true,
    sources: [
      { ref: 'Bieleninik et al., 2024, JAMA Netw Open (LongSTEP: no significant 24-mo language benefit)' },
    ],
  },
];

export const CLAIMS_BY_ID: Record<string, GradedClaim> = Object.fromEntries(
  GRADED_CLAIMS.map((c) => [c.id, c]),
);

// ── §4 Developmental-stage matrix ────────────────────────────────────────────
// ageMonths ranges are [minInclusive, maxExclusive); prenatal is flagged
// separately. allowedTempo is the FULL envelope permitted at the stage (calming
// floor → play ceiling); the parameter selector clamps per-goal against it.

export interface StageInfo {
  id: StageId;
  minMonths: number;
  maxMonths: number; // exclusive
  label: string;
  capacities: string[];
  windows: SensitiveWindow[];
  allowedTempo: TempoBand;
  maxComplexity: 1 | 2 | 3 | 4 | 5;
  vocalRegister: 'infant-directed' | 'natural';
  caveats: string[];
  screenNote: string;
}

// Screen guidance strings (§8). Audio-only music is NOT subject to screen-time
// limits, but the stage note still travels with the profile so a caller who
// pairs music with video sees the right caution.
const SCREEN = {
  underEighteen:
    'AAP: under 18 mo avoid screens except video chat. Audio-only music is exempt from screen-time limits; do not pair with video at this stage.',
  eighteenToTwentyFour:
    'AAP: 18–24 mo co-view high-quality media only. Audio-only music is exempt; keep any video co-viewed.',
  twoToFive:
    'AAP: 2–5 yr ≤1 hr/day high-quality, co-viewed. WHO: age 2 ≤1 hr, ages 3–4 ≤1 hr (less is better). Audio-only music is exempt from these caps.',
  prenatal: 'Audio only; no screens involved. Avoid high-volume abdominal ("belt") speakers.',
} as const;

export const STAGES: StageInfo[] = [
  {
    id: 'prenatal',
    minMonths: -3,
    maxMonths: 0,
    label: 'Prenatal (3rd trimester)',
    capacities: ['Hearing functional ~29 wks', 'melody/voice learning (memory short-lived post-birth)'],
    windows: ['beat-contour-innate'],
    allowedTempo: { minBpm: 55, maxBpm: 80 },
    maxComplexity: 2,
    vocalRegister: 'infant-directed',
    caveats: [
      'Effects are real but the specific memory trace fades ~21 days post-birth; the durable part is general auditory tuning.',
      'Avoid high-volume abdominal / "belt" speakers.',
    ],
    screenNote: SCREEN.prenatal,
  },
  {
    id: '0-3mo',
    minMonths: 0,
    maxMonths: 3,
    label: '0–3 months',
    capacities: ['Beat induction, contour & consonance preference present at birth', 'state regulation paramount'],
    windows: ['beat-contour-innate'],
    allowedTempo: { minBpm: 55, maxBpm: 100 },
    maxComplexity: 2,
    vocalRegister: 'infant-directed',
    caveats: ['Overstimulation risk is high; recorded ≠ live.', 'Keep quiet; no crib/near-ear speakers.'],
    screenNote: SCREEN.underEighteen,
  },
  {
    id: '3-6mo',
    minMonths: 3,
    maxMonths: 6,
    label: '3–6 months',
    capacities: ['Tempo-change detection', 'melody recognition', 'arousal modulation via singing'],
    windows: ['beat-contour-innate'],
    allowedTempo: { minBpm: 55, maxBpm: 140 },
    maxComplexity: 3,
    vocalRegister: 'infant-directed',
    caveats: ['Still pre-narrowing; rhythm processing is culture-general.'],
    screenNote: SCREEN.underEighteen,
  },
  {
    id: '6-12mo',
    minMonths: 6,
    maxMonths: 12,
    label: '6–12 months',
    capacities: ['Perceptual narrowing (phonemes & rhythm)', 'statistical learning robust'],
    windows: ['beat-contour-innate', 'phoneme-narrowing', 'rhythm-enculturation'],
    allowedTempo: { minBpm: 55, maxBpm: 140 },
    maxComplexity: 3,
    vocalRegister: 'infant-directed',
    caveats: [
      'Sensitive window: prioritize target-language exposure; non-native phoneme discrimination is declining.',
      'Foreign-rhythm exposure is still plastic here (Hannon & Trehub) but locks ~12 mo.',
    ],
    screenNote: SCREEN.underEighteen,
  },
  {
    id: '12-18mo',
    minMonths: 12,
    maxMonths: 18,
    label: '12–18 months',
    capacities: ['First words', 'culture-specific rhythm locked (~12 mo)'],
    windows: [],
    allowedTempo: { minBpm: 55, maxBpm: 150 },
    maxComplexity: 3,
    vocalRegister: 'infant-directed',
    caveats: ['Rhythm enculturation and phoneme narrowing have largely locked; native-language priority remains.'],
    screenNote: SCREEN.underEighteen,
  },
  {
    id: '18-24mo',
    minMonths: 18,
    maxMonths: 24,
    label: '18–24 months',
    capacities: ['Vocabulary spurt', 'word–melody mapping'],
    windows: [],
    allowedTempo: { minBpm: 55, maxBpm: 150 },
    maxComplexity: 4,
    vocalRegister: 'infant-directed',
    caveats: ['Songs raise attention but do not beat speech for vocabulary depth.'],
    screenNote: SCREEN.eighteenToTwentyFour,
  },
  {
    id: '2-3yr',
    minMonths: 24,
    maxMonths: 36,
    label: '2–3 years',
    capacities: ['Sentence combining', 'tempo→emotion discrimination'],
    windows: [],
    allowedTempo: { minBpm: 55, maxBpm: 160 },
    maxComplexity: 4,
    vocalRegister: 'natural',
    caveats: ['Mode (major/minor) → emotion is not yet reliable; tempo cues emotion first.'],
    screenNote: SCREEN.twoToFive,
  },
  {
    id: '3-4yr',
    minMonths: 36,
    maxMonths: 48,
    label: '3–4 years',
    capacities: ['Phonological awareness emerging', 'rhythm production'],
    windows: [],
    allowedTempo: { minBpm: 55, maxBpm: 160 },
    maxComplexity: 4,
    vocalRegister: 'natural',
    caveats: ['Executive-function transfer claims are weak.'],
    screenNote: SCREEN.twoToFive,
  },
  {
    id: '4-6yr',
    minMonths: 48,
    maxMonths: 72,
    label: '4–6 years',
    capacities: ['Mode→emotion emerging (~4–7)', 'pre-literacy'],
    windows: ['mode-emotion-emerging'],
    allowedTempo: { minBpm: 55, maxBpm: 170 },
    maxComplexity: 5,
    vocalRegister: 'natural',
    caveats: ['Reading benefits are indirect and downstream.'],
    screenNote: SCREEN.twoToFive,
  },
];

export const STAGES_BY_ID: Record<StageId, StageInfo> = Object.fromEntries(
  STAGES.map((s) => [s.id, s]),
) as Record<StageId, StageInfo>;

/** Map an age in months to a stage id (prenatal handled by the caller's flag). */
export function stageForAgeMonths(ageMonths: number): StageId {
  if (!Number.isFinite(ageMonths)) return '3-6mo'; // conservative default for a garbage age
  if (ageMonths < 0) return 'prenatal';
  for (const s of STAGES) {
    if (s.id === 'prenatal') continue;
    if (ageMonths >= s.minMonths && ageMonths < s.maxMonths) return s.id;
  }
  // Above the matrix ceiling (6 yr+) — clamp to the oldest band rather than throw.
  return '4-6yr';
}

// ── Sensitive-window reference (§4 key windows) ──────────────────────────────

export const WINDOW_INFO: Record<SensitiveWindow, { label: string; grade: EvidenceGrade; guidance: string }> = {
  'beat-contour-innate': {
    label: 'Pitch/contour & beat perception (innate, from birth)',
    grade: 'Strong',
    guidance: 'Steady beat and clear melodic contour are processed from birth and are culture-general — safe to lean on at any age.',
  },
  'phoneme-narrowing': {
    label: 'Phoneme discrimination narrowing (6–12 mo)',
    grade: 'Strong',
    guidance: 'Prioritize the target native language; non-native phoneme discrimination is declining. Keep phonemes clear (no within-line code-mixing).',
  },
  'rhythm-enculturation': {
    label: 'Rhythm/meter enculturation (locks ~12 mo)',
    grade: 'Strong',
    guidance: 'Culture-specific meter locks around 12 mo; foreign/complex-meter exposure is still plastic before then.',
  },
  'mode-emotion-emerging': {
    label: 'Mode→emotion association (~4–7 yr)',
    grade: 'Moderate',
    guidance: 'Major=happy / minor=sad becomes reliable only ~4–7 yr; below that, use tempo (not mode) to signal emotion.',
  },
};

// ── §5 Parameter → effect table ──────────────────────────────────────────────
// Each option is a concrete setting for a parameter, the goals it serves, the
// earliest stage it applies from, its evidence grade, and the natural-language
// descriptors (positive) / avoid-list (negative) handed to the generator.
// §10a: descriptive words beat numeric tags in both Suno and ElevenLabs.

export interface ParameterOption {
  key: ParameterKey;
  value: string;
  effect: string;
  goals: Goal[];
  /** Earliest stage (by index in STAGES) this option applies from. */
  fromStage?: StageId;
  grade: EvidenceGrade;
  descriptors: string[];
  avoid: string[];
  tempo?: TempoBand;
}

const CALM_GOALS: Goal[] = ['sleep', 'calm', 'feeding'];

export const PARAMETER_OPTIONS: ParameterOption[] = [
  // Tempo
  {
    key: 'tempo',
    value: 'slow (~60–80 BPM; lower end for newborns)',
    effect: 'Lowers/stabilizes arousal, heart & respiratory rate; supports sleep onset.',
    goals: CALM_GOALS,
    grade: 'Moderate', // live singing Strong; exact BPM extrapolated from lullaby acoustics + NICU work
    descriptors: ['slow', 'gentle', 'unhurried', 'lullaby tempo'],
    avoid: ['fast', 'driving', 'energetic', 'syncopated'],
    tempo: { minBpm: 60, maxBpm: 80 },
  },
  {
    key: 'tempo',
    value: 'moderate/faster (~100–140 BPM)',
    effect: 'Raises/maintains arousal; elicits attention and movement.',
    goals: ['play'],
    fromStage: '3-6mo',
    grade: 'Moderate',
    descriptors: ['lively', 'bouncy', 'upbeat', 'playful tempo'],
    avoid: ['sluggish', 'droning'],
    tempo: { minBpm: 100, maxBpm: 140 },
  },
  {
    key: 'tempo',
    value: 'moderate steady (~90–110 BPM)',
    effect: 'Holds attention without over-arousing; steady pulse supports on-task listening.',
    goals: ['focus'],
    grade: 'Moderate',
    descriptors: ['moderate', 'steady', 'even pace'],
    avoid: ['racing', 'erratic tempo'],
    tempo: { minBpm: 90, maxBpm: 110 },
  },
  {
    key: 'tempo',
    value: 'stage-appropriate, engagement-driven',
    effect: 'Tempo chosen for singability and engagement within the stage envelope.',
    goals: ['entertain'],
    grade: 'Moderate',
    descriptors: ['catchy tempo', 'singable groove'],
    avoid: ['jarring tempo changes'],
    tempo: { minBpm: 80, maxBpm: 130 },
  },
  // Meter
  {
    key: 'meter',
    value: 'steady, regular duple meter',
    effect: 'Neural entrainment; movement synchronization; supports the rhythm→phonology link.',
    goals: ['sleep', 'calm', 'play', 'feeding', 'focus'],
    grade: 'Strong', // perception Strong; reading link Moderate
    descriptors: ['steady duple meter', 'clear downbeat', 'regular pulse'],
    avoid: ['irregular meter', 'rubato', 'complex polyrhythm', 'shifting time signature'],
  },
  // Repetition
  {
    key: 'repetition',
    value: 'high repetition, simple predictable structure',
    effect: 'Feeds statistical/implicit learning; predictability calms (reduces startle scanning).',
    goals: ['sleep', 'calm', 'play', 'feeding', 'focus'],
    grade: 'Strong', // statistical learning Strong; calming Moderate
    descriptors: ['highly repetitive', 'predictable', 'simple recurring motif', 'looping'],
    avoid: ['through-composed', 'constantly changing', 'unpredictable'],
  },
  // Contour
  {
    key: 'contour',
    value: 'smooth, descending melodic contour',
    effect: 'Soothing; contour is salient to infants.',
    goals: CALM_GOALS,
    grade: 'Moderate',
    descriptors: ['smooth melodic contour', 'gentle descending phrases', 'legato'],
    avoid: ['large melodic leaps', 'jagged intervals', 'angular melody'],
  },
  // Pitch
  {
    key: 'pitch',
    value: 'higher (infant-directed register)',
    effect: 'Preferred by infants; captures attention.',
    goals: ['sleep', 'calm', 'play', 'feeding', 'focus'],
    fromStage: '0-3mo',
    grade: 'Strong', // preference Strong
    descriptors: ['higher warm register', 'infant-directed pitch'],
    avoid: ['low booming register', 'sub-bass heavy'],
  },
  // Consonance
  {
    key: 'consonance',
    value: 'consonant, low harmonic complexity',
    effect: 'Preferred over dissonance; dissonance produces negative affect / less attention.',
    goals: ['sleep', 'calm', 'play', 'feeding', 'focus'],
    grade: 'Moderate', // preference Strong; universality Contested (Plantinga & Trehub 2014 exposure effects)
    descriptors: ['consonant harmony', 'simple warm chords', 'pentatonic or major'],
    avoid: ['dissonant', 'harsh clusters', 'atonal', 'crunchy harmony'],
  },
  // Dynamics
  {
    key: 'dynamics',
    value: 'low variation, no sudden onsets',
    effect: 'Prevents Moro/startle; sustains sleep.',
    goals: ['sleep', 'calm', 'feeding'],
    grade: 'Moderate',
    descriptors: ['even dynamics', 'soft throughout', 'no sudden onsets', 'gentle attacks'],
    avoid: ['sudden loud hits', 'sharp attacks', 'dramatic crescendo', 'percussive stabs'],
  },
  {
    key: 'dynamics',
    value: 'gentle contrast / build',
    effect: 'Increases arousal and engagement.',
    goals: ['play', 'entertain'],
    fromStage: '3-6mo',
    grade: 'Emerging',
    descriptors: ['playful dynamic contrast', 'gentle build'],
    avoid: ['harsh hits', 'jarring transitions'],
  },
  // Timbre
  {
    key: 'timbre',
    value: 'soft, sustained (voice, strings, gentle keys)',
    effect: 'Associated with relaxation; harsh/bright timbres alert.',
    goals: ['sleep', 'calm', 'feeding'],
    grade: 'Moderate', // Emerging/Moderate
    descriptors: ['soft sustained timbre', 'warm voice', 'strings', 'gentle piano', 'warm pad'],
    avoid: ['bright brass', 'harsh synth', 'distortion', 'metallic percussion'],
  },
  {
    key: 'timbre',
    value: 'bright, playful',
    effect: 'Brighter/harsher timbres alert and engage during play.',
    goals: ['play', 'entertain'],
    fromStage: '3-6mo',
    grade: 'Emerging',
    descriptors: ['bright playful timbre', 'light percussion', 'xylophone', 'plucked strings'],
    avoid: ['aggressive distortion', 'harsh noise'],
  },
  // Vocal presence
  {
    key: 'vocal',
    value: 'sung (voice present), not instrumental-only',
    effect: 'Sung infant-directed delivery beats spoken/instrumental for attention and arousal modulation.',
    goals: ['sleep', 'calm', 'play', 'feeding', 'focus'],
    grade: 'Strong',
    descriptors: ['sung, not spoken', 'intimate close vocal', 'warm human voice'],
    avoid: ['instrumental-only when attention or bonding is the goal'],
  },
  // Delivery register
  {
    key: 'delivery',
    value: 'infant-directed (motherese)',
    effect: 'Higher F0, slower, expressive delivery is preferred and regulates arousal.',
    goals: ['sleep', 'calm', 'play', 'feeding'],
    fromStage: '0-3mo',
    grade: 'Strong',
    descriptors: ['infant-directed delivery', 'higher pitch, slower, exaggerated warmth'],
    avoid: ['flat adult delivery', 'fast conversational phrasing'],
  },
  // Mode
  {
    key: 'mode',
    value: 'major/minor emotion signaling (age-gated ≥ ~4 yr)',
    effect: 'Major/minor signals happy/sad reliably only from ~4–7 yr.',
    goals: ['play', 'focus', 'entertain'],
    fromStage: '4-6yr',
    grade: 'Moderate', // age-gated; NOT reliable in infancy
    descriptors: ['major key for a bright mood'],
    avoid: ['relying on minor-key sadness cues below ~4 yr'],
  },
  // Lyric language
  {
    key: 'lyric-language',
    value: 'native/target language, clear phonemes',
    effect: 'Supports native phoneme/vocab exposure within the narrowing window.',
    goals: ['sleep', 'calm', 'play', 'feeding', 'focus', 'entertain'],
    fromStage: '6-12mo',
    grade: 'Strong', // exposure Strong; via song Moderate
    descriptors: ['native-language lyrics', 'clear articulated phonemes'],
    avoid: ['within-line code-mixing', 'mumbled or slurred vocals'],
  },
];

// ── §6 Function-specific protocols ───────────────────────────────────────────

export interface Protocol {
  id: ProtocolId;
  goal: Goal;
  summary: string;
  grade: EvidenceGrade;
  /** Live-singing note where recorded/AI is a weaker substitute. */
  liveNote?: string;
}

export const PROTOCOLS: Record<ProtocolId, Protocol> = {
  lullaby: {
    id: 'lullaby',
    goal: 'sleep',
    summary: 'Tempo ~60–70 BPM; smooth descending contour; consonant simple harmony; soft sustained timbre; minimal dynamics; no sudden onsets; high repetition; soft fade-out ending; sung infant-directed register; low volume.',
    grade: 'Moderate', // Moderate–Strong
    liveNote: 'Live caregiver singing is stronger than recorded/AI for calming an actively distressed infant.',
  },
  calming: {
    id: 'calming',
    goal: 'calm',
    summary: 'Like a lullaby but tempo can be slightly higher; predictable loops; caregiver voice ideal. For active distress, live/contingent singing outperforms recorded.',
    grade: 'Strong', // Strong (live), Moderate (recorded)
    liveNote: 'Recorded/AI audio can reproduce the acoustics but not the contingent co-regulation of live singing.',
  },
  play: {
    id: 'play',
    goal: 'play',
    summary: 'Tempo ~100–140 BPM; strong steady duple meter; dynamic contrast; brighter timbre; call-and-response; playful infant-directed delivery.',
    grade: 'Moderate',
  },
  feeding: {
    id: 'feeding',
    goal: 'feeding',
    summary: 'Entrained slow rhythm/lullaby (Loewy RBL model); pacifier-activated lullaby improves oral feeding. Clinical setting; certified music therapist for NICU.',
    grade: 'Moderate',
    liveNote: 'NICU/preterm feeding support requires a certified music therapist for live entrained work; recorded audio is not a substitute in that setting.',
  },
  focus: {
    id: 'focus',
    goal: 'focus',
    summary: 'Use the song to gain attention, then deliver target content with high repetition and clear prosody; keep instrumentation simple to avoid masking lyrics; steady beat for phonological/rhythmic goals.',
    grade: 'Moderate', // Moderate (attention), Contested (vocabulary gain)
    liveNote: 'Spoken input may teach vocabulary as well as or better than song (Morini & Blair 2021); songs boost engagement, not necessarily depth.',
  },
  entertainment: {
    id: 'entertainment',
    goal: 'entertain',
    summary: 'Joy, play, silliness/humor, narrative arcs, bonding themes, cultural resonance. Prioritize engagement, singability, and age-appropriate content. No developmental claims required.',
    grade: 'Moderate',
  },
};

export const PROTOCOL_FOR_GOAL: Record<Goal, ProtocolId> = {
  sleep: 'lullaby',
  calm: 'calming',
  play: 'play',
  feeding: 'feeding',
  focus: 'focus',
  entertain: 'entertainment',
};

// ── §8 Safety guidelines ─────────────────────────────────────────────────────

export const SAFETY = {
  db: {
    nicuSustainedMax: 45, //   dB, NICU standard (AAP; EPA/WHO-aligned)
    nicuTransientMax: 65, //   dB
    homeTarget: 50, //         dB range for home infant listening
  },
  /** Hard rule: never place a speaker in the crib or near the ear. */
  forbiddenSpeakerPlacements: ['crib', 'near-ear'] as const,
  overstimulationSigns: [
    'gaze aversion',
    'arching',
    'fussing',
    'hiccups',
    'color change',
    'disorganized movement',
  ],
  sleep: [
    'No speakers or cords in the crib.',
    'Use music as part of a wind-down, then off — or keep steady low background.',
    'Avoid abrupt loud transitions (Moro/startle reflex).',
  ],
  /** Audio-only music is distinct from screens and NOT subject to screen-time
   *  limits, but continuous background audio can reduce caregiver talk. */
  audioVsScreen:
    'Audio-only music (naps/bedtime, passive listening) is treated as distinct from screens and is not subject to screen-time limits. Caveat: continuous background audio can reduce caregiver talk — do not run music continuously.',
  hearingVulnerability:
    'Preterm/NICU newborns carry ~2–4% moderate/severe hearing-loss base rates (vs ~0.1–0.3% normal), rising to ~11% in extremely preterm — warrant conservative volume.',
} as const;

// ── Product-level honest limitation (§1, §9) ─────────────────────────────────
// The single most important caveat, surfaced on every developmental brief.

export const RECORDED_CEILING_CAVEAT =
  'Recorded/AI music can reproduce the acoustic parameters (tempo, contour, timbre) but not the contingent, real-time co-regulation of live caregiver singing that drives the largest bonding and arousal effects. Position generated music as a supplement to caregiver singing, not a replacement.';
