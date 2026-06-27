# AI-Powered YouTube Studio — Build Specification

**Companion to:** *AI-Powered YouTube Studio — Project Handoff*
**Purpose:** The engineering blueprint. The handoff doc says *what* to build and *why*; this doc says *how it fits together* — every agent's input/output contract, the shared state object they all read and write, the pipeline state machine, the three human gates, and the error/retry/budget rules. A developer (or a fresh Claude session) should be able to start implementing Phase 1 directly from this.
**Status:** Design spec, v1. Build path assumed: **hybrid** (no-code orchestration + coded skills), per handoff §6.3.
**Last updated:** June 2026

---

## 1. How to read this document

The system is a **pipeline of agents** that transform one episode from an idea into a published video plus Shorts. Everything is organized around a single shared data object — the **Episode State** (§4) — that flows down the pipeline. Each agent reads specific fields from it, does its job, and writes new fields back. No agent talks to another agent directly; they communicate only through the Episode State, coordinated by the Producer.

Three rules govern the whole system:

1. **One source of truth.** The Episode State (a JSON document, one per episode) is the only thing agents share. If it isn't in the state, it didn't happen.
2. **Humans hold three gates.** Concept, Script, and Final Cut. The pipeline *pauses* at each gate and will not spend money past a gate without explicit approval.
3. **Money is metered and tracked.** Every generation step checks the budget ledger before spending and writes actual cost after. The Cost skill can throttle or halt the pipeline.

---

## 2. System overview

```
                          ┌─────────────────────────────────────────┐
                          │              PRODUCER (0)                 │
                          │  orchestrates · holds state · enforces    │
                          │  gates · tracks budget · retries          │
                          └───────────────────┬───────────────────────┘
                                              │ reads/writes Episode State
   ┌──────────────────────────────────────────────────────────────────────────┐
   │ PHASE 1 — PRE-PRODUCTION          PHASE 2 — GENERATION                     │
   │ 1 Research & Ideation             4 Voiceover                             │
   │ 2 Scriptwriter      ░GATE A░      5 Video Generation                      │
   │ 3 Visual Director   ░GATE B░      6 Asset Sourcing                        │
   │                                   8 Music & SFX                           │
   │                                                                            │
   │ PHASE 3 — ASSEMBLY + QA           PHASE 4 — DISTRIBUTION                   │
   │ 7 Editor / Assembly               9 Shorts / Repurposing                  │
   │ 12 QA / Brand-safety ░GATE C░     10 Thumbnail & Packaging                │
   │                                   11 SEO & Publishing                     │
   └──────────────────────────────────────────────────────────────────────────┘

   ░GATE A░ = Concept approval   ░GATE B░ = Script + shot-list approval
   ░GATE C░ = Final-cut approval (before publish)
```

Numbering matches the handoff §6.1 roster. (Gate B sits after the Scriptwriter *and* Visual Director because the handoff defines the script-stage human decision as approving the final script; in practice the creator approves the script and its shot list together before any paid generation begins — this is the single most important cost gate.)

---

## 3. Core conventions

### 3.1 The message envelope

Every agent is invoked by the Producer with the same envelope and returns the same envelope shape. This keeps the orchestrator uniform whether a step runs in n8n or in code.

**Invocation (Producer → Agent):**

```json
{
  "episode_id": "ep_2026_026",
  "agent": "scriptwriter",
  "state_ref": "episodes/ep_2026_026/state.json",
  "params": { "...agent-specific knobs..." },
  "budget_remaining_usd": 318.40
}
```

**Result (Agent → Producer):**

```json
{
  "episode_id": "ep_2026_026",
  "agent": "scriptwriter",
  "status": "ok",                 // ok | needs_human | retry | failed
  "writes": { "script": { "..." } },  // fields to merge into Episode State
  "cost_usd": 0.04,
  "notes": "2 takes generated, selected v2",
  "next_suggested": "visual_director"
}
```

- `status: needs_human` → Producer pauses and opens the relevant gate.
- `status: retry` → Producer re-invokes per the retry policy (§5.4).
- `status: failed` → Producer halts that branch, logs, and surfaces to the creator.

### 3.2 The three gates

| Gate | After | Human approves | What's blocked until approval | Why human, not AI |
|------|-------|----------------|-------------------------------|-------------------|
| **A — Concept** | Agent 1 | The angle/topic for this episode | Scriptwriting | AI picks safe, generic angles; the creator's taste is the differentiator |
| **B — Script + Shots** | Agents 2 & 3 | Final script and shot list | All paid generation (voice, video, music) | This is the money gate — everything downstream costs credits |
| **C — Final Cut** | Agents 7 & 12 | The assembled video | Publishing and Shorts | AI assembly is the least reliable step; never publish unreviewed |

A gate is a state transition (§5) plus a notification to the creator with a compact review payload and Approve / Revise / Reject actions. "Revise" returns control to the agent before the gate with the creator's notes attached.

### 3.3 Budget ledger

The Episode State carries a `budget` block (§4). Before any agent that spends money runs, the Producer checks `budget_remaining_usd` in the envelope against that agent's estimated cost (from the Cost skill). After the agent runs, its `cost_usd` is appended to the ledger. Monthly spend rolls up across episodes against the $500 cap (handoff §4).

---

## 4. The Episode State (shared data object)

One JSON document per episode, stored in the memory/asset layer. This is the contract every agent depends on. Fields are added as the pipeline progresses; an agent must not require a field produced by a later stage.

```json
{
  "episode_id": "ep_2026_026",
  "created_at": "2026-06-21T09:00:00Z",
  "status": "scripting",            // see §5 state list
  "channel": {
    "niche": "<TBD — open question>",
    "languages": ["en"],
    "host_mode": "real_face"        // real_face | voice_only | avatar | mixed
  },

  "concept": {                      // written by Agent 1, approved at Gate A
    "topic": "",
    "angle": "",
    "rationale": "",
    "keywords": [],
    "competitor_refs": [],
    "target_length_min": 10,
    "approved": false
  },

  "script": {                       // written by Agent 2, approved at Gate B
    "hook": "",
    "sections": [
      { "id": "s1", "vo_text": "", "shot_note": "", "on_screen": "" }
    ],
    "cta": "",
    "brand_voice_pass": false,
    "word_count": 0,
    "approved": false
  },

  "shot_list": [                    // written by Agent 3, approved at Gate B
    {
      "shot_id": "sh1",
      "section_id": "s1",
      "source": "generated",        // stock | generated | graphic | avatar | host
      "duration_s": 4,
      "prompt": { "runway": "", "kling": "", "veo": "" },
      "selected_asset": null,
      "cost_estimate_usd": 0.0
    }
  ],

  "voiceover": {                    // written by Agent 4
    "voice_id": "elevenlabs:cloned_v1",
    "clips": [ { "section_id": "s1", "audio_uri": "", "duration_s": 0 } ],
    "total_duration_s": 0
  },

  "generated_video": [              // written by Agent 5
    { "shot_id": "sh1", "model": "runway", "takes": [], "selected_uri": "", "cost_usd": 0.0 }
  ],

  "sourced_assets": [               // written by Agent 6
    { "shot_id": "sh3", "type": "stock|image", "uri": "", "license": "", "cost_usd": 0.0 }
  ],

  "music": {                        // written by Agent 8
    "track_uri": "", "sfx": [], "license": "", "cost_usd": 0.0
  },

  "edit": {                         // written by Agent 7
    "timeline_uri": "",
    "captioned": false,
    "render_uri": "",
    "duration_s": 0,
    "approved": false
  },

  "qa": {                           // written by Agent 12
    "fact_checks": [], "license_checks": [], "brand_checks": [],
    "ai_disclosure_required": true,
    "passed": false, "blocking_issues": []
  },

  "shorts": [                       // written by Agent 9
    { "short_id": "sh_a", "source_range_s": [10, 48], "render_uri": "", "hook": "" }
  ],

  "packaging": {                    // written by Agent 10
    "thumbnails": [], "titles": [], "descriptions": []
  },

  "publish": {                      // written by Agent 11
    "youtube_video_id": "", "scheduled_at": "", "tags": [],
    "chapters": [], "ai_label_applied": false, "shorts_posted": []
  },

  "budget": {
    "cap_usd_month": 500,
    "spent_this_episode_usd": 0.0,
    "ledger": [ { "agent": "video_generation", "cost_usd": 0.0, "at": "" } ]
  },

  "history": [                      // append-only audit log
    { "at": "", "agent": "research", "event": "concept_drafted" }
  ]
}
```

---

## 5. State machine

### 5.1 States

```
draft
  → researching        (Agent 1 running)
  → concept_review     ░GATE A░        → (revise) researching
  → scripting          (Agents 2, 3 running)
  → script_review      ░GATE B░        → (revise) scripting
  → generating         (Agents 4, 5, 6, 8 — parallel)
  → assembling         (Agent 7)
  → qa                 (Agent 12)
  → cut_review         ░GATE C░        → (revise) assembling
  → distributing       (Agents 9, 10, 11 — parallel)
  → published
  ── any state ──→ failed   (unrecoverable; creator notified)
  ── any state ──→ on_hold  (budget halt or manual pause)
```

### 5.2 Transition rules

- A state advances only when **all** agents in that state return `status: ok`.
- `concept_review`, `script_review`, `cut_review` are *blocking* — the pipeline holds indefinitely until the creator acts. No spend occurs while holding.
- Entering `generating` requires `script.approved && all shot_list[].prompt` populated. The Producer refuses to enter `generating` otherwise (hard guard on the money gate).
- Entering `distributing` requires `edit.approved && qa.passed`.

### 5.3 Parallelism

- **Generating** fans out: Voiceover (4), Video Generation (5), and Asset Sourcing (6) run concurrently — they read the approved script/shot list and write disjoint fields. Music (8) is `blockedBy` Voiceover (4) because it beat-syncs to `voiceover.total_duration_s`; it starts as soon as VO finishes and runs alongside 5/6. The Producer joins all four before `assembling`.
- **Distributing** fans out: Shorts (9), Packaging (10), Publishing (11). Publishing (11) is `blockedBy` Packaging (10) — it needs a thumbnail and title; Shorts (9) is independent.

### 5.4 Retry & error policy

| Failure | Policy |
|---------|--------|
| Generation take rejected by QC (Agent 5 self-check) | Re-prompt up to **2** retries with prompt variation; if still failing, fall back to Asset Sourcing (stock) for that shot and flag it |
| API timeout / 5xx | Exponential backoff, 3 attempts, then `failed` for that unit only (not the whole episode) |
| Budget would be exceeded by next step | Transition to `on_hold`, notify creator with options (top up reserve / drop shots / use stock) |
| Gate rejected | `revise` returns to the prior working state with creator notes; `reject` → `failed` |
| QA blocking issue (Agent 12) | Pipeline cannot reach `cut_review` until resolved; QA lists `blocking_issues` for the editor/creator |

---

## 6. Agent I/O contracts

Each agent below is specified as: **Responsibility · Reads · Writes · Tools/Skills · Gate · Failure modes.** "Reads/Writes" name Episode State fields (§4).

### Agent 0 — Producer / Orchestrator
- **Responsibility:** Run the state machine, invoke agents with the envelope, merge their `writes`, enforce gates, manage retries and the budget ledger, persist state.
- **Reads:** entire Episode State.
- **Writes:** `status`, `budget.ledger`, `history`; merges every agent's `writes`.
- **Tools/Skills:** orchestration layer (n8n/Make for predictable transitions; coded controller for budget + retry logic), Cost/credit skill, Memory/asset store.
- **Gate:** owns all three — opens them, waits, routes Approve/Revise/Reject.
- **Failure modes:** never spends past a gate; on ambiguous agent output, re-invokes once then escalates to creator.

### Agent 1 — Research & Ideation
- **Responsibility:** Topic/trend/keyword research, competitor scan, propose 3–5 angles with a recommended pick and rationale.
- **Reads:** `channel.niche`, `channel.languages`; memory (past episodes to avoid repeats).
- **Writes:** `concept.{topic, angle, rationale, keywords, competitor_refs, target_length_min}`.
- **Tools/Skills:** Web research skill, SEO/keyword skill.
- **Gate:** output goes to **Gate A**. Returns `needs_human`.
- **Failure modes:** thin/low-volume keywords → still propose, flag confidence; never auto-advance past Gate A.

### Agent 2 — Scriptwriter
- **Responsibility:** Turn the approved concept into a retention-structured script: hook → sections → CTA, with inline shot/B-roll notes and on-screen text, in brand voice.
- **Reads:** `concept` (approved), `channel.host_mode`, brand kit from memory.
- **Writes:** `script.{hook, sections[], cta, word_count}`, sets `brand_voice_pass`.
- **Tools/Skills:** Long-form writing skill, LLM (Claude/GPT per handoff §4 swap note).
- **Gate:** contributes to **Gate B**.
- **Failure modes:** if concept not approved, refuse; if over/under target length, self-revise to within ±15%.

### Agent 3 — Visual Director
- **Responsibility:** Convert the script into a shot list; for each line decide source (stock / generated / graphic / avatar / host) and write model-specific generation prompts; estimate per-shot cost.
- **Reads:** `script` (approved), `channel.host_mode`, `budget`.
- **Writes:** `shot_list[]` including `source`, `duration_s`, `prompt.{runway,kling,veo}`, `cost_estimate_usd`.
- **Tools/Skills:** Video-prompt skill (the highest-leverage skill, handoff §6.2), prompt library.
- **Gate:** contributes to **Gate B** (script + shots approved together).
- **Failure modes:** if total `cost_estimate` > remaining budget, propose a cheaper source mix (more stock/graphics) and flag for the creator at Gate B.

### Agent 4 — Voiceover
- **Responsibility:** Generate narration per section in the cloned voice; handle timing and pickups.
- **Reads:** `script.sections[].vo_text`, `voiceover.voice_id`.
- **Writes:** `voiceover.clips[]`, `voiceover.total_duration_s`.
- **Tools/Skills:** ElevenLabs connector.
- **Gate:** none (post-Gate B).
- **Failure modes:** mispronunciation/odd prosody → regenerate the affected clip; never block the whole VO on one line.

### Agent 5 — Video Generation
- **Responsibility:** Fire shot prompts at the right model, manage credits, generate and self-QC takes, select the best.
- **Reads:** `shot_list[]` where `source == "generated"`, `budget`.
- **Writes:** `generated_video[]` (`takes`, `selected_uri`, `cost_usd`).
- **Tools/Skills:** Runway (primary, relaxed-mode batching for "a lot" of video), Kling (variety/quality), Veo (via bundles); Cost skill.
- **Gate:** none, but **budget-aware** — respects retry/fallback policy (§5.4).
- **Failure modes:** failed take → re-prompt ×2 → fall back to stock via Agent 6, flag shot.

### Agent 6 — Asset Sourcing
- **Responsibility:** Find matched stock B-roll and generate still images; serve as the fallback target for failed generations.
- **Reads:** `shot_list[]` where `source in {stock, graphic}` (and fallback requests from Agent 5).
- **Writes:** `sourced_assets[]` (`uri`, `license`, `cost_usd`).
- **Tools/Skills:** Asset-matching skill, stock provider, Midjourney (images that can also feed image-to-video).
- **Gate:** none.
- **Failure modes:** no good stock match → request a generated shot or a Canva graphic; always record license.

### Agent 8 — Music & SFX
- **Responsibility:** Select/generate a track and SFX, beat-sync to runtime; ensure YouTube-safe licensing.
- **Reads:** `voiceover.total_duration_s`, `concept.angle` (mood), brand kit.
- **Writes:** `music.{track_uri, sfx[], license, cost_usd}`.
- **Tools/Skills:** Epidemic Sound (licensed library), optional Suno for generated cues.
- **Gate:** none.
- **Failure modes:** licensing ambiguity → prefer Epidemic library track; record license ID for QA.

### Agent 7 — Editor / Assembly
- **Responsibility:** Sync visuals to narration, build the timeline, add captions, remove silence/filler, mix audio, render the cut.
- **Reads:** `voiceover`, `generated_video`, `sourced_assets`, `music`, `script` (for caption text/on-screen).
- **Writes:** `edit.{timeline_uri, captioned, render_uri, duration_s}`.
- **Tools/Skills:** Descript; Captioning + assembly skill.
- **Gate:** output goes to **Gate C** (after QA).
- **Failure modes:** missing asset for a shot → insert placeholder + flag; never silently drop a section.

### Agent 12 — QA / Brand-safety
- **Responsibility:** Fact-check claims, verify all asset licenses, brand-voice pass, determine AI-disclosure requirement (YouTube SynthID/C2PA, handoff §5).
- **Reads:** `script`, `edit`, `sourced_assets`, `music`, `generated_video`, `voiceover`.
- **Writes:** `qa.{fact_checks, license_checks, brand_checks, ai_disclosure_required, passed, blocking_issues}`.
- **Tools/Skills:** Brand/compliance skill + checklists, Web research skill (fact-check).
- **Gate:** gatekeeper for **Gate C** — `passed` must be true to reach `cut_review`.
- **Failure modes:** any unlicensed asset or failed claim → `blocking_issues`, pipeline holds.

### Agent 9 — Shorts / Repurposing
- **Responsibility:** Cut the long video into vertical Shorts with hooks; auto-post or queue.
- **Reads:** `edit.render_uri`, `publish` (once main video is up, for linking).
- **Writes:** `shorts[]` (`source_range_s`, `render_uri`, `hook`).
- **Tools/Skills:** Opus Clip.
- **Gate:** none (post-Gate C).
- **Failure modes:** weak clip candidates → reduce count rather than ship low-quality.

### Agent 10 — Thumbnail & Packaging
- **Responsibility:** Produce thumbnail options and title/description variants tuned for CTR.
- **Reads:** `concept`, `script.hook`, `edit.render_uri` (frames).
- **Writes:** `packaging.{thumbnails[], titles[], descriptions[]}`.
- **Tools/Skills:** Midjourney + Canva; SEO/keyword skill.
- **Gate:** none, but its output is `blocking` for Publishing.
- **Failure modes:** must deliver ≥2 thumbnail + ≥3 title variants.

### Agent 11 — SEO & Publishing
- **Responsibility:** Tags, chapters, schedule, upload, apply AI-disclosure label, cross-post.
- **Reads:** `edit.render_uri`, `packaging`, `concept.keywords`, `qa.ai_disclosure_required`.
- **Writes:** `publish.{youtube_video_id, scheduled_at, tags, chapters, ai_label_applied, shorts_posted}`.
- **Tools/Skills:** YouTube API connector, SEO skill.
- **Gate:** none — but **blockedBy** Agent 10 and requires `qa.passed`.
- **Failure modes:** upload fail → retry/backoff; if `ai_disclosure_required` and label can't be applied, hold rather than publish non-compliant.

---

## 7. Shared skills (the reusable layer)

Agents are thin; the leverage is here (handoff §6.2). Each skill has a stable signature so multiple agents can call it.

| Skill | Signature (in → out) | Used by |
|-------|----------------------|---------|
| Web research | `query → {summary, sources[]}` | 1, 12 |
| SEO/keyword | `topic → {keywords[], volumes, competitor_titles, ctr_patterns}` | 1, 10, 11 |
| Long-form writing | `concept + brand_voice → script` | 2 |
| **Video-prompt** | `script_line + style + model → optimized_prompt` | 3 (build first) |
| Asset-matching | `script_line → ranked stock/image candidates` | 6 |
| Captioning + assembly | `clips + vo + music → captioned timeline` | 7 |
| Brand/compliance | `artifact → {voice_ok, banned_claims[], license_ok, ai_label_needed}` | 12 |
| Cost/credit | `planned_step → est_cost; actual → ledger_entry; → throttle?` | 0, 3, 5 |
| Memory/asset store | `get/put(brand_kit, past_scripts, style, episode_history)` | all |

API connectors (ElevenLabs, Runway, Kling, Descript, Opus Clip, Midjourney, YouTube) sit beneath these skills.

---

## 8. Implementation notes by phase

Build order follows handoff §6.4. Each phase is shippable on its own.

**Phase 1 — Pre-production (start here; lowest risk, biggest time save).**
Build: Episode State store, Producer skeleton (states `draft → script_review`), Agents 1–3, Gates A & B, the **Video-prompt skill**, and the SEO/keyword + long-form writing skills. *Deliverable:* approved script + shot list + ready-to-run prompts, with zero paid generation. This validates the whole front half before any credits are spent.

**Phase 2 — Generation (credit-heavy core).**
Build the **Cost/credit skill first**, then Agents 4, 5, 6, 8 with the generating fan-out, take self-QC, and the stock fallback path. Wire the budget guard on entry to `generating`. This is where the $500 cap is enforced in practice.

**Phase 3 — Assembly + QA (hardest to automate).**
Agents 7 and 12, the captioning/assembly and brand/compliance skills, and Gate C. Keep the human final-cut gate permanently — do not try to automate it away.

**Phase 4 — Distribution (easy wins, automate last).**
Agents 9, 10, 11 with the distributing fan-out and the Publishing-blockedBy-Packaging dependency. Apply AI-disclosure labels here.

---

## 9. Open questions that change this spec

These come from handoff §7 and directly affect fields/agents above:

1. **Host mode** (`channel.host_mode`) — decided by the HeyGen trial. Affects Agent 3 source decisions and whether an avatar agent path is active.
2. **Niche** (`channel.niche`) — needed to tune the Research, SEO, and brand-voice skills; currently TBD.
3. **Build path** — hybrid assumed; if pure-code, the Producer becomes a coded state machine rather than n8n.
4. **Brand kit** — must exist in the memory store before Agent 2/8/10 produce on-brand output.
5. **Languages** (`channel.languages`) — multi-language turns on the avatar-dub use case and a translation step.

---

## 10. Suggested next builds

- Draft the actual system prompts for Agents 1–3 (Phase 1).
- Build the Video-prompt skill (Runway/Kling/Veo) — referenced throughout and the highest-leverage component.
- Map this state machine to concrete n8n nodes/triggers.
- Stand up the Episode State store + brand kit in the memory layer.

*End of build specification.*
