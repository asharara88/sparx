# Early-Childhood Music System (ECMS)

A character-led, **audio-first** AI music system for early childhood development,
covering the prenatal third trimester through age 6. The system generates music,
voices, lyrics, character identities, and age-gated audiovisual content through a
15-agent pipeline that is **evidence-gated, age-aware, music-first, and
safety-conscious by construction** — safety and claims are enforced by
deterministic validators, never left to model judgment.

## Core product principle

For babies and young infants, **music and audio are the experience**. Characters
function primarily as voice identities, music personas, and parent-facing
visuals. Video is never the default experience below age 2. From toddler and
preschool stages, character-led visuals are introduced cautiously as short,
co-viewed, low-stimulation routines. Sleep and wind-down content stays
audio-only at **every** age — the system never builds a screen-dependent sleep
association.

## Document map

| Doc | Contents |
|-----|----------|
| [01-architecture.md](01-architecture.md) | Full multi-agent architecture, agent-by-agent responsibilities, inputs/outputs, deterministic vs. generative split |
| [02-policy-matrices.md](02-policy-matrices.md) | The deterministic rulebook: age-stage modality matrix, music parameter tables, claim allow/block lists, safety rules and their enforcement points |
| [03-roadmap.md](03-roadmap.md) | Implementation roadmap for building this as a real product, mapped onto the existing sparx agent framework |
| [schemas/system.schema.json](schemas/system.schema.json) | JSON Schema (2020-12) for every object the pipeline passes between agents |
| [examples/character-bible.json](examples/character-bible.json) | Full character bible: five launch characters conforming to the schema |
| [examples/music-package-sleep.json](examples/music-package-sleep.json) | End-to-end example content package: a sleep track for a 5-month-old |
| [examples/runway-prompt.md](examples/runway-prompt.md) | Example Runway job for an age-3 routine micro-video, with post-render QC gates |
| [examples/suno-udio-prompt.md](examples/suno-udio-prompt.md) | Example Suno and Udio prompts derived from a MusicSpec |

## The one-sentence architecture

**Generators propose; validators dispose.** LLMs and media models (Claude,
OpenAI, Suno, Udio, ElevenLabs, Runway, HeyGen, future internal models) do the
creative work inside hard parameter envelopes; deterministic, versioned policy
tables decide what modalities a child may receive, what claims may be made, and
whether a rendered asset ships. Every gate fails closed: on any error or
ambiguity the system degrades to audio-only, claim-free, low-stimulation
defaults — or halts for human review.

## Relationship to the sparx codebase

This design deliberately reuses the sparx agent framework
([docs/Agent-Framework.md](../Agent-Framework.md)): each ECMS agent is a
`defineAgent()` unit with declared `reads`/`writes` (write-whitelist enforced),
`requires()` preconditions, and a deterministic Producer-style orchestrator
that owns retries, budgets, and the audit trail. See the roadmap for the
concrete mapping.
