# Example Suno / Udio Prompts — "Moonrise Hum" (sleep, `m4_6`)

Compiled by the Tool Adapter from the `MusicSpec` in
[music-package-sleep.json](music-package-sleep.json). The adapter never
free-writes prompts: every phrase below is a templated rendering of a spec
field, so the prompt cannot smuggle in unspecified content.

## Suno (v4.5)

**Style prompt** (from `timbre_palette`, `tempo_bpm`, `meter`, `key`,
`dynamics`, `composition_brief`):

```
Gentle infant lullaby, 60 BPM, 6/8 rocking sway, F major. Soft female humming
leads over felt piano and slow harp arpeggios, warm analog pad underneath.
Extremely soft and even dynamics, no percussion, no drums, smooth legato
phrases 4-8 seconds long with gentle 1-2 second pauses between phrases.
Descending melodic phrases that always settle downward and resolve. Warm,
dark, rounded tone with rolled-off highs. Sparse, mostly hummed vocals with a
few soft words. Slows down slightly near the end and closes with a very long
soft fade to a single held tonic note. Intimate, caregiver-like, unhurried.
```

**Exclude styles** (from `timbre_palette.block` + lane blocklist):

```
drums, percussion, EDM, trap, rock, brass, bells, chimes, sound effects,
risers, builds, drops, whispering ASMR, theatrical vocals, loud, energetic,
fast, staccato, dramatic dynamics
```

**Lyrics block** (from `LyricsSpec.lines` + `structure.sections`; hum sections
encoded explicitly so the model doesn't invent words):

```
[Intro — humming only]
Mmm... mmm... loo loo loo

[Verse]
Moon is soft, loo loo loo
So are you, loo loo loo

[Verse — half hummed]
Moon is soft, mmm mmm mmm
Mmm mmm, loo loo loo

[Bridge — very soft]
Warm and slow, low and low

[Verse — humming only]
Mmm... loo loo loo
Mmm... loo loo loo

[Outro — humming, long fade]
Mmm... mmm... mmm...
```

Adapter flags: `instrumental_first_pass: true` (generate the bed first, then
layer the ElevenLabs vocal stem in the internal mixdown, where LUFS/true-peak/
fade targets are enforced deterministically — the mastering numbers in the
spec are applied by our mixdown job, never left to the music model).

## Udio (same spec, Udio's prompt shape)

**Prompt:**

```
A very gentle lullaby for a small baby. 60 BPM, 6/8 time, F major. Soft warm
female humming melody, felt piano, slow harp, warm pad. No drums, no
percussion. Long smooth descending phrases with gentle pauses. Quiet, even,
intimate and unhurried throughout, like a caregiver rocking a baby. Ends with
a long slow fade on the tonic.
```

**Tags:** `lullaby, ambient folk, humming, 6/8, 60bpm, F major, soft female
vocal, felt piano, harp, warm, intimate, quiet, sparse, slow fade ending`

**Negative tags:** `drums, percussion, edm, loud, epic, cinematic rise, bells,
fast, energetic, whisper asmr, sound effects`

## Post-render enforcement (both providers)

Generated audio is *measured* before mixdown and again on the master:

- Tempo detection within 56–62 BPM; re-render if outside.
- Onset/transient scan: no event > 6 dB above the 3 s moving average.
- Spectral check: energy above 8 kHz rolled off; no 2–5 kHz harshness peaks.
- Structure check: total duration, phrase pauses, and ≥ 15 s ending fade.
- Mixdown normalizes to −20 LUFS integrated, LRA ≤ 3, true peak ≤ −3 dBTP.

The model's job is the *feel*; the numbers are ours.
