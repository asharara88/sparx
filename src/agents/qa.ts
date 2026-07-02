import { defineAgent } from './core.js';
import { getLLM } from '../llm/client.js';
import { checkCompliance, isLicenseAccepted, reviewBrandVoice } from '../skills/brandCompliance.js';
import { requiredDisclosureLines, techClaimRules, TECH_SECTION_ID } from '../skills/techSegment.js';

// Agent 12 — QA / Brand-safety. Gatekeeper for GATE C (qa.passed must be true).
// FAIL-CLOSED on real detected problems, non-blocking on unverifiable-in-mock ones:
//   - coverage + licensing + banned phrases: deterministic (brand-compliance skill;
//     'mock'/'pexels'-family licenses accepted so zero-key runs pass)
//   - fact_check: unsupported claims block; 'uncertain' only surfaces in notes
//   - render_qc: a checked-and-failed render blocks; unchecked is a note
//   - captions: narration without cues is a non-blocking brand note
//   - LLM brand-voice review: a throw is a blocking issue, never a silent pass
//     (MockLLM never throws, so zero-key runs are unaffected)

export const qa = defineAgent({
  name: 'qa',
  description: 'Gate C gatekeeper: deterministic coverage/licensing/compliance checks plus fact-check, render-QC, caption, and LLM brand-voice review.',
  skills: ['brand-compliance', 'tech-segment'],
  reads: ['script', 'shot_list', 'generated_video', 'avatar_clips', 'sourced_assets', 'music', 'voiceover', 'fact_check', 'render_qc', 'captions', 'tech_segment', 'channel'],
  writes: ['qa'],
  requires: (s) => (s.shot_list.length === 0 ? 'no shot list to review' : null),

  async execute(ctx) {
    const s = ctx.state;
    const blocking: string[] = [];
    const fact_checks: string[] = [];
    const brand_checks: string[] = [];

    // coverage: every shot resolved to a generated clip, avatar clip, or sourced asset
    const covered = new Set([
      ...s.generated_video.map((g) => g.shot_id),
      ...s.avatar_clips.map((a) => a.shot_id),
      ...s.sourced_assets.map((a) => a.shot_id),
    ]);
    const uncovered = s.shot_list.filter((x) => !covered.has(x.shot_id));
    if (uncovered.length) blocking.push(`${uncovered.length} shots without a visual: ${uncovered.map((x) => x.shot_id).join(', ')}`);

    // licensing + banned phrases + disclosure — deterministic, fail-closed
    const compliance = checkCompliance(s);
    blocking.push(...compliance.issues);
    const licensed = s.sourced_assets.filter((a) => isLicenseAccepted(a.license)).length;
    const license_checks = [
      `${licensed}/${s.sourced_assets.length} assets licensed`,
      s.music.track_uri ? (isLicenseAccepted(s.music.license) ? 'music licensed' : 'music license not recognized') : 'no music track',
    ];
    const ai_disclosure_required = compliance.disclosure_required;

    // fact check (verified at Gate B): unsupported claims block; uncertain is informational
    if (s.fact_check.checked) {
      if (s.fact_check.unsupported_count > 0) {
        const bad = s.fact_check.claims.filter((c) => c.verdict === 'unsupported');
        blocking.push(`${s.fact_check.unsupported_count} unsupported claims: ${bad.map((c) => c.claim).join('; ')}`);
      }
      fact_checks.push(...s.fact_check.claims.map((c) => `${c.verdict}: ${c.claim}`));
      if (s.fact_check.claims.length === 0) fact_checks.push('no checkable claims');
    } else fact_checks.push('fact check not run');

    // render QC: only a real probed failure blocks; unchecked = mock/no-ffprobe run
    if (s.render_qc.checked && !s.render_qc.passed) blocking.push(`render failed QC: ${s.render_qc.issues.join('; ')}`);
    else if (!s.render_qc.checked) brand_checks.push('render unverified');

    // captions: narration without a caption track hurts reach — flag, don't block
    if (s.voiceover.clips.length > 0 && s.captions.cue_count === 0) brand_checks.push('narration present but no caption cues');

    // Tech-slot compliance (deterministic — disclosure is law/brand, not style):
    //   - the slot must exist in the script (it's a format promise)
    //   - the right disclosure copy for the sponsorship status must appear verbatim
    //     (sponsored → paid-partnership disclosure is a LEGAL requirement)
    //   - spotlight/hybrid: no generative render of the real product slipped through
    const ts = s.tech_segment;
    if (ts?.enabled) {
      const techSec = s.script.sections.find((x) => x.id === TECH_SECTION_ID);
      if (!techSec) {
        blocking.push('tech segment enabled but missing from script');
      } else {
        const lines = requiredDisclosureLines(ts, s.channel.languages);
        if (!lines.some((l) => techSec.vo_text.includes(l))) {
          blocking.push(ts.sponsored
            ? 'sponsored tech segment without paid-partnership disclosure (legal requirement)'
            : 'tech segment missing independence disclosure line');
        }
      }
      if (ts.mode !== 'explainer') {
        const techShotIds = new Set(s.shot_list.filter((sh) => sh.section_id === TECH_SECTION_ID).map((sh) => sh.shot_id));
        const genProduct = s.generated_video.filter((g) => techShotIds.has(g.shot_id));
        if (genProduct.length) blocking.push(`${genProduct.length} generative render(s) of a real product in the tech segment`);
      }
    }

    // LLM brand-voice review, skipped when deterministic checks already hold the
    // episode — the verdict is a hold either way, and the post-fix re-run pays once.
    let cost = 0;
    if (blocking.length === 0) {
      try {
        const techRules = ts?.enabled
          ? `The section with id "${TECH_SECTION_ID}" is a ${ts.mode}-mode tech segment. ${techClaimRules(ts.mode)}`
          : undefined;
        const { review, cost_usd } = await reviewBrandVoice(s.script, getLLM(), techRules);
        cost = cost_usd;
        if (!review.claims_ok) blocking.push('unverifiable-as-phrased claims flagged');
        if (!review.brand_ok) blocking.push('brand-voice issue flagged');
        brand_checks.push(review.brand_ok && review.claims_ok ? 'brand voice ok' : 'brand review flagged issues', ...review.issues);
      } catch (err) {
        // the safety gate must not pass while its reviewer is down — fail closed
        ctx.log.error('LLM brand review threw — failing closed', { err: String(err).slice(0, 200) });
        blocking.push('LLM review unavailable');
      }
    } else brand_checks.push('LLM review skipped (already blocking)');

    const passed = blocking.length === 0;
    ctx.log.info('qa complete', { passed, blocking: blocking.length, aiDisclosure: ai_disclosure_required });
    return {
      writes: { qa: { fact_checks, license_checks, brand_checks, ai_disclosure_required, passed, blocking_issues: blocking } },
      cost_usd: cost,
      notes: passed ? 'QA pass' : `QA hold: ${blocking.length} issues`,
    };
  },
});
