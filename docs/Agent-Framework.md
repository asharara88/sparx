# sparx Agent Framework

How agents, skills, and the Producer fit together after the 2026-07 overhaul.
For the original product spec see [YouTube-Studio-Build-Spec.md](YouTube-Studio-Build-Spec.md).

## Agents

Every agent is declared with `defineAgent()` ([src/agents/core.ts](../src/agents/core.ts)):

```ts
export const captions = defineAgent({
  name: 'captions',
  description: 'Generate timed SRT + WebVTT caption tracks …',
  skills: ['captioning'],            // validated against the skill registry at startup
  reads: ['script', 'voiceover'],    // documented inputs
  writes: ['captions'],              // ENFORCED — undeclared writes fail the run
  requires: (s) => s.script.sections.length === 0 ? 'no script sections' : null,
  async execute(ctx) {               // ctx = invocation + bound logger (ctx.log)
    …
    return { writes: { captions: … }, cost_usd: 0, notes: '…' };
  },
});
```

The runtime wrapper (not the agent) owns the cross-cutting behavior:

- **Error boundary** — a thrown retryable `PipelineError` becomes status `retry`;
  any other throw becomes `failed` with the message in `notes`. Agents never
  need their own try/catch shells, and nothing escapes `Producer.run` anymore.
- **Write whitelist** — the Producer merges `writes` blindly into the shared
  `EpisodeState` (agents own disjoint top-level fields by contract), so the
  runtime rejects a result whose writes include undeclared keys.
- **Preconditions** — `requires()` turns missing-upstream-input into a clean
  `failed` result with a reason instead of an uncaught exception.
- **Timing** — every result carries `duration_ms`, recorded into episode history
  (`ok:… [12.3s]`).

`validateAgents(AGENTS)` + `validateMachine(AGENTS)` run in the `Producer`
constructor: a typo'd stage name or skill declaration is a startup error, not a
mid-pipeline surprise.

## Skills

Skills are named, typed capabilities with a uniform contract
([src/skills/registry.ts](../src/skills/registry.ts)); they self-register at
module import and `src/skills/index.ts` is the registration hub.

| Skill | Purpose |
|---|---|
| `web-research` | provider-backed search (Tavily / mock) |
| `seo-keywords` | keyword clustering + primary phrase selection |
| `evidence-retrieval` | claim → retrieved evidence → verdict (fail-closed) |
| `brand-compliance` | banned phrases, license validation, disclosure (fail-closed) |
| `reference-validation` | validate LLM-produced cross-references (shot↔section ids) |
| `cost-model` | single source of pricing truth; estimate before every paid step |
| `artifact-cache` | content-keyed cache — retries never re-bill identical inputs |
| `channel-memory` | cross-episode store: topics, titles, post-publish performance |
| `timeline` | canonical EDL resolution shared by editor + render |
| `media-probe` | ffprobe wrapper: measured durations/streams over guesses |
| `captioning` | timed SRT/WebVTT generation from narration + clip durations |
| `video-clipping` | ffmpeg trim + 9:16 reframe for Shorts |
| `asset-matching` | stock query construction + candidate ranking |

## Pipeline

```
research ──gate A── scriptwriter ──┬── fact_checker      (claims verified pre-spend)
                                   └── visual_director
        ──gate B── voiceover ∥ video_generation ∥ avatar ∥ asset_sourcing → music
        → editor → captions ∥ render → render_qc → qa ──gate C──
        → shorts ∥ packaging → shorts_renderer ∥ publishing → published
                                                  └─(later)─ analytics_feedback
```

New agents added by the overhaul:

- **fact_checker** — extracts checkable claims after scripting and verifies them
  against web evidence, so factual problems surface at Gate B *before*
  generation money is spent. QA blocks on `unsupported` claims at Gate C.
- **captions** — real timed SRT/VTT (previously `edit.captioned` was hardcoded
  and no caption file ever existed). Runs concurrently with the render.
- **render_qc** — ffprobes the actual mp4 (duration drift, missing audio,
  sub-720p) before QA; unverifiable renders are reported as `checked: false`,
  never fabricated passes.
- **shorts_renderer** — cuts each planned short into a real 9:16 vertical clip
  (previously shorts shipped fictional `render://` URIs).
- **analytics_feedback** — post-publish; folds views/retention into channel
  memory (`npm run analytics -- <episode_id>`), which research (topic dedup)
  and packaging (title patterns) read on the next episode.

## Performance model

- **Across agents**: the state machine runs stage members concurrently
  (unchanged), e.g. voiceover ∥ video ∥ avatar ∥ stock.
- **Within agents**: per-item provider calls (sections, shots, clips,
  thumbnails, stock lookups) run through `mapLimit`/`settleLimit`
  ([src/util/concurrency.ts](../src/util/concurrency.ts)) bounded by
  `MEDIA_CONCURRENCY` (default 4) — stage wall clock is ~max(item) instead of
  sum(items).
- **HTTP**: all provider calls go through `fetchWithRetry`
  ([src/util/http.ts](../src/util/http.ts)) — per-attempt timeout
  (`HTTP_TIMEOUT_MS`), transient-only retry, `Retry-After` support. Long polls
  use `pollUntil` with provider-specific deadlines.
- **Caching**: `artifact-cache` short-circuits paid regeneration when inputs
  hash identically (`ARTIFACT_CACHE=false` to disable); long LLM system prompts
  are marked for Anthropic prompt caching automatically.

## Money

Every paid step estimates with `cost-model` before spending and reports actual
`cost_usd` in its result; the Producer records the ledger. Voice pricing was
corrected (~1000x undercount), avatar/video/image rates consolidated, and
agents consult `budget_remaining_usd` / `shouldThrottle` before expensive
dispatches.
