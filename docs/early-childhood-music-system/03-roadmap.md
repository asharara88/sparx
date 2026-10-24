# ECMS Implementation Roadmap

How to build this as a real product, phased so that **every release is safe on
its own** — the audio-only product must be complete and valuable before a
single frame of child-facing video exists. Timeboxes assume a small senior
team; treat them as sequencing, not promises.

---

## Phase 0 — Foundations & governance (weeks 0–6)

The unglamorous phase that makes everything else defensible.

**Build**
- Policy Engine: `policies/*.json` (age bands, modality matrix, music
  envelopes, visual thresholds, claim registry, cue library, safety rules) +
  loader, semver, and CI validation against
  [schemas/system.schema.json](schemas/system.schema.json).
- Pipeline skeleton on the sparx agent framework: each ECMS agent as a
  `defineAgent()` unit (declared `reads`/`writes`, `requires()`
  preconditions), orchestrated by a Producer-style deterministic state
  machine with the existing write-whitelist, retry, budget, and audit
  patterns. Concretely: a new `src/agents/ecms/` module family and a
  `policies/` directory; the gate agents (3, 4, 6, 15) are pure functions
  with table lookups and 100% branch test coverage.
- Audit log + provenance store; human review queue (a simple table + UI is
  enough at first).

**Govern**
- Recruit the child-development advisory board (developmental psychologist,
  pediatric sleep specialist, pediatric audiologist, early-childhood music
  educator). They own sign-off on every `policies/` change.
- Legal/compliance workstream starts now: COPPA, GDPR + UK Age-Appropriate
  Design Code, ad-free commitment, data-minimization DPIA, provider
  data-processing terms (what leaves our walls in a Suno/ElevenLabs payload:
  answer — nothing about the child).
- Claim registry reviewed by counsel + board; blocked-claim classifier
  red-teamed with paraphrase attacks.

**Exit criteria:** policy bundle v1 signed off; gate agents pass a golden test
suite (every band × lane × parent-override combination); an end-to-end dry run
produces a mock `ContentPackage` that validates against the schema.

## Phase 1 — Audio-only MVP: sleep & calm (weeks 6–16)

**Scope:** `sleep_calm` + `bonding` lanes; bands `prenatal_t3`–`m12_17`;
characters **Luma** and **Wren**; providers Suno (music), ElevenLabs (voice),
internal mixdown; parent app with intake, library, and guidance.

**Build**
- Music Intelligence v1: spec generation inside the sleep envelope; the
  measurement stack (LUFS/LRA/true-peak/transient/tempo/fade analysis — ffmpeg
  + ebur128 + onset detection, in-repo).
- Voice Casting + Prosody v1 with the locked Luma voice and infant variant;
  cue library live (including the canonical breath cue).
- Evidence & Claim-Gating v1 on all app copy and package text.
- Final Compliance v1: full audio QC + packaging checks; fail-closed wiring.
- Parent experience: onboarding that *teaches* (device placement, volume,
  overstimulation signs), no streaks, no autoplay, instant soft-stop button.

**Validate**
- Internal listening panel + advisory board review of 50 generated packages.
- Closed pilot with 30–50 families; measure *parent-reported routine fit* and
  ease, not child outcomes (we make no outcome claims).

**Exit criteria:** 95%+ of generated packages pass compliance on first or
second attempt; zero blocked-claim leaks in pilot copy; pilot NPS and routine
adherence justify Phase 2.

## Phase 2 — Play, language, routines; full audio catalog (weeks 16–28)

**Scope:** all six lanes in audio; bands through `y5_6`; characters **Pip,
Lila, Tock** activated; Udio as second music provider with automatic fallback.

**Build**
- Music Intelligence v2: play/language/routine envelopes, call-and-response
  and echo-song structures, response-gap timing per band.
- Lyrics Agent with tiered lexicons + bilingual echo songs (per-language
  recorded voice variants — no synthetic accent crossover).
- Character Identity registry with casting rules and cross-character
  constraints; character creation workflow (draft → schema check → board
  review → approved).
- Parent-facing static visuals (m4_6+) and the printable/parent-card system.
- Evaluation harness: golden packages per lane × band, regression-tested on
  every policy or prompt-template change; adversarial suite (claim smuggling,
  envelope-edge specs, provider drift detection).

**Exit criteria:** full audio catalog generation at quality; provider fallback
proven in chaos tests; measurement stack catches seeded violations at 100%.

## Phase 3 — First visuals: micro-visuals and micro-video (weeks 28–40)

The most sensitive phase. Nothing here ships without board sign-off.

**Scope:** `m18_23` parent-controlled micro-visuals (near-static, ≤ 90 s);
`m24_35` co-viewed micro-video (≤ 5 min); Runway image-to-video from approved
stills only.

**Build**
- Visual & Motion Safety Agent: spec side + the measurement stack (flicker
  analyzer, shot-boundary detector, optical-flow magnitude, palette/saturation
  histograms, character-fidelity embedding check).
- Script & Scene Agent with ritual templates, co-viewing prompts, and the
  parent gate; Tool Adapter Runway integration (pinned models, seeds, budget).
- Co-viewing UX: video cannot start without the parent gate; ends in closing
  ritual → parent screen; session caps enforced server-side.

**Validate**
- Every rendered template's first 20 outputs human-reviewed; co-viewed pilot
  sessions observed with parent consent (observing parents, never recording
  children).

**Exit criteria:** zero flicker/motion violations reaching the compliance gate
across 500 rendered clips; pilot parents can articulate the co-viewing model
back to us (the guidance is actually landing).

## Phase 4 — Preschool experiences & personalization (weeks 40–56)

**Scope:** `y3`–`y5_6` short videos, rhythm/rhyme/routine videos, fuller
5–6 y experiences; careful personalization; HeyGen parent-guide videos.

**Build**
- Extended scene templates (dance-along, routine sequences) within band
  thresholds; purpose tags on every y5_6 package.
- Personalization that stays on the safe side: routine names, favorite
  instruments, tempo-of-household preferences; child's name in lyrics only at
  y3+ with explicit consent and only via our own TTS path (names are never
  sent to third-party providers).
- Parent education library fronted by Wren (HeyGen avatar, claim-gated
  scripts).
- Cost/scale work: caching by (lane × band × signature) with variation seeds;
  pre-rendered catalog + on-demand generation hybrid.

**Exit criteria:** catalog + on-demand economics validated; personalization
DPIA passed; no personalization datum ever leaves first-party infrastructure.

## Phase 5 — Internal models & continuous assurance (week 56+)

- **Internal music model:** fine-tuned/owned generation for the signature
  sound, trained on licensed + commissioned material only; slots behind the
  same Tool Adapter interface and the same measurement gates — internal models
  get zero trust discount.
- **Internal voice stack** for full control of infant-facing prosody.
- Continuous assurance: quarterly policy review with the board; provider-drift
  monitors (distribution of measured audio/visual metrics per provider,
  alarmed); annual third-party safety audit; public transparency page (what we
  claim, what we block, how gating works).
- Longitudinal *product* research (routine fit, caregiver satisfaction) with
  an IRB-reviewed protocol if we ever study children directly — and claims
  still never exceed the allowlist until evidence and the board move it.

---

## Team (steady state through Phase 3)

| Role | Why |
|------|-----|
| Product/CTO (you) | Owns the principle: audio-first, evidence-gated |
| 2× platform engineers | Orchestrator, policy engine, adapters, measurement stack |
| 1× audio DSP engineer | Measurement, mixdown, mastering pipeline |
| 1× ML engineer | Claim classifier, visual QC models, provider evals |
| 1× music director (early-childhood) | Envelopes, signatures, listening QA |
| 1× child-development lead (part-time + board) | Policy tables, guidance copy |
| 1× designer | Character bible visuals, parent UX |
| Counsel (fractional) | COPPA/GDPR-K/AADC, claims |

## The three riskiest bets (and their mitigations)

1. **Generative audio can't reliably hit the envelope** → we never depend on
   it: models produce *feel*, our mixdown produces *numbers*; re-render loops
   are budgeted; a pre-rendered approved catalog always backstops on-demand
   generation.
2. **Claim leakage in the long tail of copy** → two-pass gating, semantic
   matching, fail-closed stripping, and the rule that benefit language exists
   only as allowlisted strings.
3. **Video pressure from the market** ("kids' apps have video") → the modality
   matrix is product identity, not a growth lever; it can only be changed by
   the advisory board through a policy release, not by an A/B test. That
   constraint is the moat: trust.
