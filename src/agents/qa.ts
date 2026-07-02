import type { Agent } from './types.js';
import { ok } from './types.js';
import { getLLM } from '../llm/client.js';
import { QAReviewSchema } from '../schemas/phase34.js';
import { requiredDisclosureLines, techClaimRules, TECH_SECTION_ID } from '../skills/techSegment.js';
import { createLogger } from '../logger.js';

// Agent 12 — QA / Brand-safety. Gatekeeper for GATE C (qa.passed must be true).
//   - deterministic checks: every shot has a visual, every sourced asset has a license
//   - AI-disclosure required iff any generated video was used
//   - LLM review: claims + brand-voice safety (schema-validated)
export const qa: Agent = {
  name: 'qa',
  async run(ctx) {
    const log = createLogger({ agent: 'qa', episode: ctx.episode_id });
    const llm = getLLM();
    const blocking: string[] = [];

    // coverage: every shot resolved to a clip or an asset
    const haveGen = new Set(ctx.state.generated_video.map((g) => g.shot_id));
    const haveAsset = new Set(ctx.state.sourced_assets.map((a) => a.shot_id));
    const haveAvatar = new Set(ctx.state.avatar_clips.map((a) => a.shot_id));
    const uncovered = ctx.state.shot_list.filter((s) => !haveGen.has(s.shot_id) && !haveAsset.has(s.shot_id) && !haveAvatar.has(s.shot_id));
    if (uncovered.length) blocking.push(`${uncovered.length} shots without a visual: ${uncovered.map((s) => s.shot_id).join(', ')}`);

    // licensing: all sourced assets + the music track must be licensed
    const license_checks: string[] = [];
    const unlicensed = ctx.state.sourced_assets.filter((a) => !a.license || a.license === 'unknown');
    if (unlicensed.length) blocking.push(`${unlicensed.length} unlicensed assets`);
    license_checks.push(`${ctx.state.sourced_assets.length - unlicensed.length}/${ctx.state.sourced_assets.length} assets licensed`);
    if (!ctx.state.music.license || ctx.state.music.license === 'unknown') blocking.push('music track unlicensed');

    const ai_disclosure_required = ctx.state.generated_video.length > 0 || ctx.state.avatar_clips.length > 0;

    // Tech-slot compliance (deterministic — disclosure is law/brand, not style):
    //   - the slot must exist in the script (it's a format promise)
    //   - the right disclosure copy for the sponsorship status must appear verbatim
    //     (sponsored → paid-partnership disclosure is a LEGAL requirement)
    //   - spotlight/hybrid: no generative render of the real product slipped through
    const ts = ctx.state.tech_segment;
    if (ts?.enabled) {
      const techSec = ctx.state.script.sections.find((x) => x.id === TECH_SECTION_ID);
      if (!techSec) {
        blocking.push('tech segment enabled but missing from script');
      } else {
        const lines = requiredDisclosureLines(ts, ctx.state.channel.languages);
        if (!lines.some((l) => techSec.vo_text.includes(l))) {
          blocking.push(ts.sponsored
            ? 'sponsored tech segment without paid-partnership disclosure (legal requirement)'
            : 'tech segment missing independence disclosure line');
        }
      }
      if (ts.mode !== 'explainer') {
        const techShotIds = new Set(ctx.state.shot_list.filter((sh) => sh.section_id === TECH_SECTION_ID).map((sh) => sh.shot_id));
        const genProduct = ctx.state.generated_video.filter((g) => techShotIds.has(g.shot_id));
        if (genProduct.length) blocking.push(`${genProduct.length} generative render(s) of a real product in the tech segment`);
      }
    }

    // LLM claim + brand review
    const review = await llm.complete({
      tier: 'fast', temperature: 0.2, schema: QAReviewSchema,
      system: 'You are a QA reviewer for YouTube content. Flag unverifiable factual claims and brand-safety/voice issues. Be specific and conservative.',
      prompt: `Hook: ${ctx.state.script.hook}\nNarration:\n${ctx.state.script.sections.map((s) => s.vo_text).join('\n')}${ts?.enabled ? `\n\nThe section with id "${TECH_SECTION_ID}" is a ${ts.mode}-mode tech segment. ${techClaimRules(ts.mode)}` : ''}\n\nReturn JSON {claims_ok:boolean, brand_ok:boolean, issues:string[]}.`,
      mock: JSON.stringify({ claims_ok: true, brand_ok: true, issues: [] }),
    });
    const r = review.data!;
    const issues = r.issues ?? [];
    if (!r.claims_ok) blocking.push('unverified factual claims flagged');
    if (!r.brand_ok) blocking.push('brand-safety issue flagged');

    const passed = blocking.length === 0;
    log.info('qa complete', { passed, blocking: blocking.length, aiDisclosure: ai_disclosure_required, provider: llm.live ? 'llm' : 'mock' });
    return ok(ctx, {
      qa: {
        fact_checks: issues.length ? issues : ['no claim issues'],
        license_checks,
        brand_checks: [r.brand_ok ? 'brand voice ok' : 'brand issue', ...issues],
        ai_disclosure_required,
        passed,
        blocking_issues: blocking,
      },
    }, review.usage.costUsd, passed ? 'QA pass' : `QA hold: ${blocking.length} issues`);
  },
};
