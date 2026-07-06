# Music & Early-Childhood Specialist

An evidence-graded knowledge base + rule engine that turns a caregiver/product
request ("a calming song for my 4-month-old") into a **graded, safety-checked
AI-music-generation brief** for ElevenLabs / Suno / Udio. It encodes the research
review on music and development from prenatal to 6 years and is used as the
guidelines layer whenever the pipeline prompts for AI music.

Code: [src/childmusic/](../src/childmusic/) · CLI: `npm run childmusic`

## Bottom line (what the evidence supports)

- **Proven / usable:** music's reliable near-term effects on infants are
  *physiological and socioemotional* — arousal regulation, calming, sleep,
  feeding stability, bonding. Lullaby acoustics calm; infant-directed singing is
  preferred; beat/contour perception is innate.
- **Hype / debunked:** the "Mozart effect", "smarter baby" / Baby-Einstein
  claims, lasting cognitive gains from passive listening, and *music-driven*
  bilingual acceleration. The system **refuses to assert these**.
- **The load-bearing caveat:** recorded/AI music reproduces the *acoustics* but
  not the *contingency* of live caregiver singing. Generated music is positioned
  as a **supplement**, not a replacement. This caveat rides on every
  developmental brief.

## Architecture (§10 of the review, as code)

The specialist is the §10b agent architecture implemented as deterministic rule
engines plus a generative-within-constraints composer:

```
routeGoal ─────────────┐   (Developmental-Goal Router — rule-based)
profileStage ──────────┤   (Age/Stage Profiler — rule-based, stage ceilings)
   │                   │
   ├── selectParameters ┤  (Parameter selector — stage-clamped §5 table)
   ├── planLyrics       ┤  (Lyrics scaffolding — generative within templates)
   │                   │
claimsForBrief ────────┤   (Evidence-Citation Grounder — grades + over-claim gate)
   │                   │
checkSafety ───────────┘   (Safety/Compliance gate — HARD, fail-closed, runs last)
   │
buildPrompts → { elevenlabs, suno, udio }   (per-tool adapters — §10a)
```

`composeChildMusicBrief(request)` runs the whole chain and returns a
`ChildMusicBrief` whose `status` is `ok` only when the safety gate passes.

**Deterministic (never generative):** goal routing, stage-appropriateness
(tempo/complexity ceilings by age, sensitive-window flags), all safety rules,
and evidence-claim gating. **Generative (within the rule-constrained envelope):**
melodic/lyrical creativity, prompt phrasing, entertainment content.

Each rule engine is also registered as a sparx skill (`child-music-router`,
`child-music-stage-profiler`, `child-music-parameters`, `child-music-safety`,
`child-music-evidence`, `child-music-specialist`) so a future pipeline agent can
declare them by name.

## Traceability

Every generation parameter (§5) and every user-facing claim (§2) carries an
`EvidenceGrade` (`Strong | Moderate | Emerging | Contested | Debunked`). The
knowledge base ([knowledge.ts](../src/childmusic/knowledge.ts)) is the single
source of truth — nothing hard-codes a claim, tempo, or grade inline, so when the
evidence changes it changes in one place.

## Safety gate (hard rules, non-overridable)

Fail-closed, runs last, mirrors `brandCompliance`:

- **Hard block:** in-crib / near-ear speaker placement.
- **Volume:** home ~50 dB; NICU/preterm ≤45 dB sustained / ≤65 dB transient.
- **Sleep:** no cords in crib; wind-down then off (or steady low background);
  avoid abrupt loud transitions (Moro/startle).
- **Audio ≠ screen:** audio-only music is exempt from AAP/WHO screen caps, but
  continuous background audio reduces caregiver talk — don't run it continuously.
- **Overstimulation:** stop on gaze aversion, arching, fussing, hiccups, colour
  change, disorganized movement.

An unrecognized delivery setting is treated as a warning, never a silent pass.

## Evidence grounding (over-claim gate)

`groundClaim(text)` screens any developmental claim and **blocks** IQ/cognitive
boosts, accelerated bilingual/L2 acquisition, passive-listening brain change, and
long-term-transfer claims — returning a safe, graded hedge instead. Bilingual
briefs carry an explicit blocked guardrail documenting what must *not* be said;
Arabic/English early-childhood music evidence is flagged as essentially absent.

## Usage

### CLI

```bash
npm run childmusic -- "help my 4-month-old fall asleep"
npm run childmusic -- --goal play --age 8 --lang en
npm run childmusic -- --goal focus --age 20 --lang ar,en --tool suno
npm run childmusic -- "bedtime" --age 1 --speaker crib     # demonstrates a hard block
npm run childmusic -- "bedtime" --age 1 --json             # machine-readable brief
```

Flags: `--goal sleep|calm|play|feeding|focus|entertain`, `--age <months>`,
`--stage <id>`, `--prenatal`, `--lang en,ar`, `--speaker room|crib|near-ear|headphones`,
`--continuous`, `--nicu`, `--no-caregiver`, `--tool elevenlabs|suno|udio`, `--json`.
The process exits non-zero when the brief is blocked.

### Programmatic

```ts
import { composeChildMusicBrief } from './src/childmusic/index.js';

const brief = composeChildMusicBrief({ text: 'calm my newborn', ageMonths: 1 });
if (brief.status === 'ok') {
  // hand brief.prompts.elevenlabs (a music_v2 prompt + composition plan) to the
  // ElevenLabs Music API, or brief.prompts.suno / .udio to those tools.
}
```

The ElevenLabs prompt is directly compatible with the in-repo provider
([src/media/music.ts](../src/media/music.ts)) and the `music_v2` composition-plan
format documented in [.agents/skills/music/SKILL.md](../.agents/skills/music/SKILL.md).
Suno/Udio conventions are version-dependent — the adapters emit descriptive words
(never numeric tags Suno/Udio ignore) and carry `caveats` to verify at build time.

## Honest limitations

- Infant "benefit" evidence is short-term physiological/affective, not long-term
  cognitive (the LongSTEP RCT found no significant 24-month language benefit).
- Cognitive/academic transfer is contested and pertains to *active training*,
  not passive infant listening.
- Rhythm→reading is largely correlational; the causal signal is clinical.
- Music-driven bilingual acquisition is the thinnest area — do not claim it.
- Exact-BPM claims are extrapolations from lullaby acoustics + NICU work; the
  defensible core is "slower calms, faster activates."
