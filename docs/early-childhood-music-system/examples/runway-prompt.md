# Example Runway Job — "Tock's Tidy-Up Time", shot 3 of 6 (age band `y3`)

Video generation is only reachable at `m24_35`+ and never in the sleep lane.
This example is one shot from a 6-shot, 4-minute routine micro-video for a
3-year-old. The Tool Adapter compiles each `ScenePlan` shot into an
**image-to-video** job seeded from an approved character still — text-to-video
from scratch is not allowed for child-facing content, because character
identity and visual safety must start from a reviewed image.

## The compiled ToolJob

```json
{
  "job_id": "JOB-RWY-5512-S3",
  "provider": "runway",
  "model_version": "gen4_turbo",
  "task": "image_to_video",
  "payload": {
    "promptImage": "s3://ecms-assets/characters/tock/tidyup_still_v1.png",
    "promptText": "Gentle storybook animation, soft matte textures. A calm sage-green tortoise with a smooth honey-brown shell slowly places one wooden toy block into an open basket, moving at one step per second, movements smooth and deliberate like a slow metronome. Camera locked, no camera movement. Soft warm even lighting, plain cream nursery wall background, muted colors, low contrast. The tortoise nods slowly and smiles gently after placing the block. Slow, calm, minimal motion throughout.",
    "duration": 10,
    "ratio": "1280:768",
    "seed": 442017
  },
  "constraints_from_visual_safety_spec": {
    "age_band": "y3",
    "min_shot_seconds": 4,
    "camera": "locked",
    "median_optical_flow_pct_frame_per_s_max": 4,
    "flash_policy": { "flashing_allowed": false, "max_fullscreen_luminance_step_pct": 10 },
    "palette_limits": { "max_hues": 6, "saturation_cap": "muted" },
    "max_focal_elements": 3
  },
  "budget_usd_max": 2.0,
  "status": "pending"
}
```

## Prompt-construction rules the adapter applied

- **Positive-space phrasing.** Video models follow described motion better than
  negations, so the prompt *describes* slowness ("one step per second",
  "camera locked", "minimal motion") rather than relying on "no fast motion".
- **Identity from the still, not the text.** The approved still carries Tock's
  design; the text only directs action, so the character can't drift.
- **One action per shot.** Each shot does exactly one telegraphed thing,
  aligned to a musical phrase in the `MusicSpec`.
- **Seed + model version pinned** for reproducibility and audit.

## What the prompt cannot guarantee, measurement must

Prompts are requests. After render, Visual & Motion Safety measures the clip
and Final Compliance enforces:

| Check | Limit (y3) | Method |
|-------|-----------|--------|
| Flicker / flash | zero flashes; no full-screen luminance step > 10%/frame | per-frame luminance histogram delta |
| Shot length | ≥ 4 s (this job is a single 10 s shot) | shot-boundary detection |
| Motion magnitude | median optical flow ≤ 4% frame width/s | dense optical flow |
| Palette | ≤ 6 hues, muted saturation | hue clustering + saturation histogram |
| Character fidelity | matches approved still | embedding similarity vs. reference |

A clip failing any check is regenerated with the same seed ± bounded retries;
two failures send the shot to human review. The assembled video additionally
gets the opening/closing ritual shots, cuts only on phrase boundaries, and the
co-viewing parent gate before playback.
