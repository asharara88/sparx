import { join } from 'node:path';
import { defineAgent } from './core.js';
import { clipVertical } from '../skills/videoClipping.js';
import { mapLimit } from '../util/concurrency.js';
import { config } from '../config.js';

// Agent — Shorts Renderer. Turns the shorts plan's source ranges into REAL
// vertical clips cut from the rendered episode (the plan previously shipped
// fictional render:// URIs that no code ever produced). Runs in distributing,
// parallel with publishing.

export const shortsRenderer = defineAgent({
  name: 'shorts_renderer',
  description: 'Cut each planned short from the rendered episode as a real 9:16 vertical clip via ffmpeg.',
  skills: ['video-clipping'],
  reads: ['shorts', 'edit'],
  writes: ['shorts'],

  async execute(ctx) {
    const plan = ctx.state.shorts;
    if (plan.length === 0) return { writes: {}, notes: 'no shorts planned' };

    const source = ctx.state.edit.render_uri;
    const rendered = await mapLimit(plan, config().MEDIA_CONCURRENCY, async (short) => {
      const [startS, endS] = short.source_range_s;
      const out = join('generated', ctx.episode_id, 'shorts', `${short.short_id}.mp4`);
      const clip = await clipVertical({ sourceUri: source, startS, endS, outPath: out }).catch((e) => {
        ctx.log.warn('short clip failed', { short: short.short_id, err: String(e).slice(0, 160) });
        return { uri: '', durationS: endS - startS, real: false };
      });
      return { ...short, render_uri: clip.real ? clip.uri : short.render_uri };
    });

    const real = rendered.filter((s, i) => s.render_uri !== plan[i]!.render_uri).length;
    ctx.log.info('shorts rendered', { planned: plan.length, real });
    return {
      writes: { shorts: rendered },
      notes: real > 0 ? `${real}/${plan.length} shorts cut to vertical mp4` : `no real source render; ${plan.length} shorts left as plan refs`,
    };
  },
});
