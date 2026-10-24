# ECMS Policy Matrices (the deterministic rulebook)

These tables are the normative content of the Policy Engine. They ship as
versioned JSON under `policies/` and are the *only* authority for age gating,
music parameter envelopes, visual thresholds, claims, and safety rules. Agents
read them; models never override them. Current version: `ecms-policy/1.0.0`.

---

## 1. Age-stage modality matrix

Audience: `child` = child-facing, `parent` = parent-facing only.
`Co-view` = an engaged adult must be present (product enforces via session
design and guidance, and never presents child-facing video without the
co-viewing start gate).

| Band | Age | Audio | Static visual | Micro-visual | Video | Session cap (visual) | Notes |
|------|-----|-------|---------------|--------------|-------|------------------|-------|
| `prenatal_t3` | 3rd trimester | ✅ parent device | ❌ (parent app UI only) | ❌ | ❌ | — | Audio for parent + fetus; moderate volume, external speaker, never belly headphones |
| `m0_3` | 0–3 mo | ✅ | ❌ | ❌ | ❌ | — | Audio only |
| `m4_6` | 4–6 mo | ✅ | ✅ optional, **parent-facing** (app art, printables) | ❌ | ❌ | — | Character exists as art the parent sees, not a screen for the baby |
| `m7_11` | 7–11 mo | ✅ | ✅ parent-facing | ❌ | ❌ default | — | Audio-first; no baby-facing video by default |
| `m12_17` | 12–17 mo | ✅ | ✅ parent-facing | ❌ default | ❌ default | — | Avoid video as default |
| `m18_23` | 18–23 mo | ✅ | ✅ | ✅ **parent-controlled micro-visuals only**: single scene, near-static (motion ≤ breathing rate, ~0.2 Hz), ≤ 90 s, parent-initiated | ❌ | ≤ 2 min/day | The visual is an illustration that barely moves, not a video |
| `m24_35` | 24–35 mo | ✅ | ✅ | ✅ | ✅ **micro-video**: short, co-viewed, low-stimulation | ≤ 5 min/session, ≤ 1 session/day | Co-view required; parent gate to start |
| `y3` | 3 y | ✅ | ✅ | ✅ | ✅ short character-led video | ≤ 8 min/session | Co-view strongly encouraged; parent gate |
| `y4` | 4 y | ✅ | ✅ | ✅ | ✅ rhythm, rhyme & routine videos | ≤ 12 min/session | Movement-along content allowed |
| `y5_6` | 5–6 y | ✅ | ✅ | ✅ | ✅ fuller character-led music/video, still low-stimulation & purposeful | ≤ 20 min/session | Purpose tag required (music, movement, routine, language) |

**Universal overrides (apply to every band):**

- `sleep_calm` lane → **audio-only at every age**. No screen is ever part of
  falling asleep (SR-08).
- Parent overrides may only restrict, never expand.
- `autoplay: false` always; every video ends in the closing ritual and returns
  to a parent-facing screen. No queues, no "up next," no reward loops (SR-07).
- Preterm infants use corrected age until 24 months.

---

## 2. Music parameter envelopes (lane × band)

Music Intelligence must emit specs inside these envelopes; Final Compliance
measures the rendered audio against them. Loudness values are mastering
targets; playback guidance is separate (§4).

### 2.1 `sleep_calm` (all bands)

| Parameter | Envelope |
|-----------|----------|
| Tempo | 50–70 BPM (default 60); optional ritardando ≤ 10% across final third |
| Meter | 6/8, 3/4, or gentle 4/4 |
| Melodic contour | Descending bias; stepwise; range ≤ one octave; smooth (no leaps > P5) |
| Repetition | ≥ 60% repeated material; AABA or verse–refrain lull cycles |
| Phrase length | 4–8 s, followed by predictable 1–2 s pauses |
| Timbre allowlist | Voice/hum, felt piano, harp, soft strings, music box (soft), warm pads, gentle acoustic guitar |
| Timbre blocklist | Drum kit, brass, distorted anything, bells above mp, synth leads, risers |
| Dynamics | Integrated ≈ −20 LUFS; LRA ≤ 3 LU; true peak ≤ −3 dBTP; no transient > 6 dB above the 3 s moving average (SR-03) |
| Spectrum | Gentle high-shelf roll-off above ~8 kHz for `prenatal_t3`–`m7_11`; no harsh 2–5 kHz resonance |
| Spatial | Mono-compatible; no moving panning; no binaural motion effects for infants |
| Ending | ≥ 15 s fade resolving to tonic; never a cold stop |

### 2.2 `play_movement`

| Parameter | m4_6–m7_11 | m12_17–m18_23 | m24_35 | y3–y4 | y5_6 |
|-----------|-----------|---------------|--------|-------|------|
| Tempo (BPM) | 76–96 | 84–104 | 90–112 | 96–120 | 96–126 |
| Beat | Steady, clearly marked, no syncopation surprises | same | light syncopation ok | moderate | moderate |
| Call-and-response gap | 2.0–2.5 s | 1.8–2.2 s | 1.5–2.0 s | 1.2–1.8 s | 1.0–1.5 s |
| Movement cues | none (bounce-with-caregiver only) | clap, wave, bounce | stomp, tap, sway | dance-along steps | sequenced moves |
| Dynamics | −18 LUFS, LRA ≤ 5 | −16 LUFS, LRA ≤ 6 | −16, ≤ 6 | −15, ≤ 7 | −14, ≤ 8 |
| Universal | No screaming/shouting vocals, no drops/risers, no abrupt tempo changes; ending winds down over ≥ 8 s to a calm close |

### 2.3 `language_exposure`

Tempo 70–96 BPM; echo-song structure (model → gap → repeat slot); one target
word or phrase per 4-bar unit; target word repeated ≥ 4× per song; melodic
mirroring between languages in bilingual pairs; syllable density ≤ 3/s
(≤ 2/s below m12); everything else inherits the nearest calm/play envelope by
band.

### 2.4 `routine_support`

Tempo 84–104 BPM; verse structure mirrors the task steps in fixed order; the
**same melody is reused for the same routine every time** (predictability is
the mechanism); one routine per song; ends with the routine's completion line
and a calm close.

### 2.5 `bonding` and `parent_education`

`bonding`: inherits `sleep_calm` or gentle-play envelope by intent; always
includes caregiver-interaction prompts (rock, hold, eye contact) in parent
guidance, not barked into the child audio. `parent_education`: adult content
norms, fully claim-gated, delivered by the Parent Guide character only.

---

## 3. Visual & motion thresholds (when visuals are permitted at all)

| Threshold | m18_23 micro-visual | m24_35 | y3 | y4 | y5_6 |
|-----------|--------------------|--------|----|----|------|
| Max duration | 90 s | 5 min | 8 min | 12 min | 20 min |
| Min shot length | n/a (single scene) | 6 s | 4 s | 3.5 s | 3 s |
| Cuts | none | on musical phrase boundaries only | phrase boundaries | phrase-aligned | phrase-aligned |
| Camera | locked | locked or pan ≤ 3%/s frame width | pan ≤ 5%/s | pan ≤ 5%/s, slow push ok | pan/push ≤ 7%/s |
| Median optical flow | ≤ 1% frame width/s | ≤ 2% | ≤ 4% | ≤ 5% | ≤ 6% |
| Character motion | breathing-rate only (~0.2 Hz) | slow, predictable, telegraphed | + gentle dance | + action-song moves | + sequenced choreography |
| Palette | muted, warm, ≤ 4 hues | ≤ 5 hues, mean saturation capped | ≤ 6 hues | ≤ 6 hues | ≤ 7 hues |
| Focal elements | 1 | ≤ 2 | ≤ 3 | ≤ 3 | ≤ 4 |
| On-screen text | none | none | none child-facing | minimal (single words, y4 pre-readers: decorative only) | short labels |

**Universal visual rules (every band, no exceptions):**

- **Zero flashing** (SR-04): no flash sequences at all; never more than 3
  luminance transitions/second anywhere in frame; no full-screen luminance
  step > 10% between consecutive frames; flicker energy kept far below
  photosensitivity thresholds. Measured, not promised.
- No fast cuts (SR-05): shot lengths above are hard minimums.
- No aggressive motion (SR-06): no rushing toward camera, no shaking, no
  startle poses; character appearances/disappearances fade ≥ 2 s.
- Opening and closing rituals mandatory; closing ritual is the definitive end.
- Parent guidance card attached to every package containing any visual asset
  (SR-09).

---

## 4. Claim registry

### 4.1 Allowlist (the only permitted benefit claims)

| ID | Approved phrasing | Evidence tier |
|----|-------------------|---------------|
| `CLM-A01` | "may support calming" | established |
| `CLM-A02` | "designed for sleep-routine support" | established (as design intent) |
| `CLM-A03` | "supports bonding when paired with caregiver interaction" | established |
| `CLM-A04` | "uses age-aware acoustic parameters" | design fact |
| `CLM-A05` | "can support language exposure" | emerging |

Rules: benefit statements must use these phrasings (or registered
translations); hedge words ("may", "can", "designed for") are part of the
claim and may not be dropped; claims never appear in child-facing audio.

### 4.2 Blocklist (hard fail, matched lexically and semantically)

| ID | Blocked claim family |
|----|----------------------|
| `BLK-01` | boosts IQ |
| `BLK-02` | makes babies smarter |
| `BLK-03` | accelerates brain development |
| `BLK-04` | guarantees better sleep |
| `BLK-05` | accelerates bilingual fluency |
| `BLK-06` | replaces caregiver singing |
| `BLK-07` | clinically proven for all babies |

Paraphrases count ("your little genius will…", "sleep, guaranteed", "as good
as mom's voice"). Anything semantically adjacent above the similarity
threshold fails closed to neutral descriptive copy or human review.

---

## 5. Safety rules and enforcement points

| ID | Rule | Enforced by |
|----|------|-------------|
| SR-01 | No crib speakers — device out of reach, ≥ 2 m from the sleep surface, never inside/attached to the crib; never headphones on infants; never belly headphones prenatally | Parent guidance required in every package (verified by Agent 15); onboarding UX |
| SR-02 | No loud audio — mastering caps (§2) + playback guidance: quiet-conversation level (≤ ~60 dB SPL at the child's position; aim lower for sleep) | Agents 7 (spec), 14 (render), 15 (measurement + guidance check) |
| SR-03 | No sudden transitions — transient and loudness-delta ceilings; crossfades only | Agents 7, 15 (transient scan) |
| SR-04 | No flashing visuals — zero-flash policy (§3) | Agents 12 (spec + measurement), 15 |
| SR-05 | No fast cuts — min shot lengths per band | Agents 12, 13, 15 |
| SR-06 | No aggressive motion — optical-flow caps, telegraphed motion, fade transitions | Agents 8 (motion rules), 12, 15 |
| SR-07 | No autoplay addiction loops — `autoplay:false` always, closing rituals, no queues/hooks/streaks/rewards | Agents 13, 15; product UX |
| SR-08 | No sleep dependency on screens — sleep lane is audio-only at every age; sleep guidance names the caregiver, not the device, as the settler | Agents 4, 5, 15 |
| SR-09 | Parent guidance whenever video is used — co-viewing instructions, session caps, environment setup | Agents 13, 15 |
| SR-10 | Stop on overstimulation — guidance teaches the signs (gaze aversion, back arching, fussing, splayed fingers, turning away) and instructs stop-and-soothe; app provides an always-visible instant-stop that fades out softly | Agent 15 (guidance check); product UX |

---

## 6. Character & voice rules (registry constraints)

Every registry character must satisfy the `Character` schema (unique ID, name,
role, age-band suitability, personality, forbidden traits, voice identity,
music signature, visual identity, motion rules, tool-stack compatibility,
safety boundaries, usage restrictions by age) and these invariants:

- Exactly one archetype per character; launch archetypes: **Sleep Guardian,
  Play Companion, Language Friend, Routine Buddy, Parent Guide**.
- One canonical voice identity per character per language; locked provider
  settings; per-age delivery variants (infant variant is softer/slower).
- Infant-facing voice checklist (all required): warm, soft, caregiver-like,
  slow, predictable, non-theatrical. Automatic rejects: loud, hyperactive,
  sarcastic, sharp, chaotic, spooky.
- Voice sourcing: consented adult voice actors or synthetic voices with
  documented provenance; **never** clone a child's voice; never clone any real
  person without written consent.
- Canonical cue library governs recurring cue wording. Calming breath cue:
  **"breathe in deep, breathe out slow"** — the inversion "breathe in slow,
  breathe out deep" is a registered forbidden variant (auto-corrected).
- Cross-character staging: Play Companion never appears in sleep-lane or
  bedtime-adjacent content; Sleep Guardian never appears in high-energy
  content; Parent Guide never addresses the child.
