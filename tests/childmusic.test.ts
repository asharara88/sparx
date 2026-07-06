import { describe, expect, it } from 'vitest';
import {
  composeChildMusicBrief,
  routeGoal,
  profileStage,
  selectParameters,
  planLyrics,
  checkSafety,
  groundClaim,
  claimsForBrief,
  toElevenLabs,
  toSuno,
  toUdio,
  RECORDED_CEILING_CAVEAT,
  STAGES_BY_ID,
} from '../src/childmusic/index.js';
import '../src/childmusic/index.js'; // registers the specialist skills
import { hasSkill } from '../src/skills/registry.js';

describe('goal router', () => {
  it('infers a goal from free text and selects the protocol', () => {
    const r = routeGoal({ text: 'please help my baby fall asleep at bedtime' });
    expect(r.goal).toBe('sleep');
    expect(r.protocol).toBe('lullaby');
    expect(r.inferred).toBe(true);
    expect(r.intent).toBe('developmental');
  });

  it('honors an explicit goal without inference', () => {
    const r = routeGoal({ goal: 'play' });
    expect(r.goal).toBe('play');
    expect(r.inferred).toBe(false);
    expect(r.protocol).toBe('play');
  });

  it('routes a silly/fun ask to the entertainment intent', () => {
    const r = routeGoal({ text: 'a silly fun song to sing along and giggle' });
    expect(r.goal).toBe('entertain');
    expect(r.intent).toBe('entertainment');
  });

  it('falls back to the conservative calming protocol on no match', () => {
    const r = routeGoal({ text: 'xyzzy nothing relevant here' });
    expect(r.goal).toBe('calm');
    expect(r.inferred).toBe(true);
  });

  it('breaks a calm/sleep tie toward sleep by precedence', () => {
    const r = routeGoal({ text: 'calm my baby down to sleep' });
    expect(r.goal).toBe('sleep');
  });
});

describe('stage profiler', () => {
  it('maps age in months to the right stage', () => {
    expect(profileStage({ ageMonths: 8 }).stage).toBe('6-12mo');
    expect(profileStage({ ageMonths: 1 }).stage).toBe('0-3mo');
    expect(profileStage({ ageMonths: 40 }).stage).toBe('3-4yr');
  });

  it('flags the phoneme-narrowing window at 6–12 months', () => {
    const p = profileStage({ ageMonths: 9 });
    expect(p.windows).toContain('phoneme-narrowing');
    expect(p.windows).toContain('rhythm-enculturation');
  });

  it('handles prenatal and clamps complexity + register for newborns', () => {
    expect(profileStage({ prenatal: true }).stage).toBe('prenatal');
    const p = profileStage({ ageMonths: 2 });
    expect(p.maxComplexity).toBeLessThanOrEqual(2);
    expect(p.vocalRegister).toBe('infant-directed');
  });

  it('surfaces the mode→emotion window only at 4–6 yr', () => {
    expect(profileStage({ ageMonths: 60 }).windows).toContain('mode-emotion-emerging');
    expect(profileStage({ ageMonths: 24 }).windows).not.toContain('mode-emotion-emerging');
  });
});

describe('parameter selection', () => {
  it('selects lullaby parameters for a sleep goal, with graded choices', () => {
    const plan = selectParameters({ goal: 'sleep', stage: '0-3mo', envelope: STAGES_BY_ID['0-3mo'].allowedTempo });
    const tempo = plan.choices.find((c) => c.key === 'tempo');
    expect(tempo).toBeDefined();
    expect(tempo!.tempo!.maxBpm).toBeLessThanOrEqual(80);
    expect(plan.choices.every((c) => typeof c.grade === 'string')).toBe(true);
    expect(plan.choices.find((c) => c.key === 'timbre')!.descriptors.join(' ')).toMatch(/soft|strings|piano/);
  });

  it('clamps a protocol tempo down to the stage envelope, never up', () => {
    const plan = selectParameters({ goal: 'play', stage: '3-6mo', envelope: { minBpm: 55, maxBpm: 120 } });
    expect(plan.tempoClamped).toBe(true);
    expect(plan.tempo.maxBpm).toBe(120); // 140 wanted, clamped to the 120 ceiling
    expect(plan.notes.join(' ')).toMatch(/clamped/);
  });

  it('drops a stage-inappropriate fast tempo instead of forcing it on a newborn', () => {
    const env = STAGES_BY_ID['0-3mo'].allowedTempo;
    const plan = selectParameters({ goal: 'play', stage: '0-3mo', envelope: env });
    expect(plan.choices.find((c) => c.key === 'tempo')).toBeUndefined(); // playsong tempo is 3mo+
    expect(plan.tempo.maxBpm).toBe(env.maxBpm);
  });
});

describe('safety gate (fail-closed)', () => {
  const base = { goal: 'sleep' as const, stage: '0-3mo' as const, continuous: false, nicu: false, caregiverPresent: true, tempo: { minBpm: 60, maxBpm: 70 } };

  it('hard-blocks in-crib and near-ear speakers', () => {
    const crib = checkSafety({ ...base, speaker: 'crib' });
    expect(crib.passed).toBe(false);
    expect(crib.blocks.length).toBeGreaterThan(0);
    expect(checkSafety({ ...base, speaker: 'near-ear' }).passed).toBe(false);
  });

  it('passes a clean room-speaker sleep setup with actionable guidance', () => {
    const r = checkSafety({ ...base, speaker: 'room' });
    expect(r.passed).toBe(true);
    expect(r.guidance.some((g) => /dB/.test(g))).toBe(true);
    expect(r.guidance.some((g) => /Moro|wind-down|crib/i.test(g))).toBe(true);
  });

  it('tightens volume guidance for NICU/preterm', () => {
    const r = checkSafety({ ...base, speaker: 'room', nicu: true });
    expect(r.guidance.some((g) => /45 dB/.test(g))).toBe(true);
  });

  it('warns about continuous background audio for non-sleep goals', () => {
    const r = checkSafety({ ...base, goal: 'play', speaker: 'room', continuous: true });
    expect(r.warnings.some((w) => /caregiver talk/i.test(w))).toBe(true);
  });

  it('treats an unknown speaker placement as a warning, not a silent pass', () => {
    const r = checkSafety({ ...base, speaker: 'bluetooth-pillow' as unknown as 'room' });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('hard-blocks headphones for infants/toddlers but only warns for older children', () => {
    const infant = checkSafety({ ...base, stage: '0-3mo', speaker: 'headphones' });
    expect(infant.passed).toBe(false);
    expect(infant.blocks.join(' ')).toMatch(/headphone/i);
    const older = checkSafety({ ...base, goal: 'entertain', stage: '4-6yr', speaker: 'headphones' });
    expect(older.passed).toBe(true);
    expect(older.warnings.join(' ')).toMatch(/headphone/i);
  });
});

describe('evidence grounder', () => {
  it('blocks the IQ / Mozart over-claim with a graded hedge', () => {
    const g = groundClaim('this music will boost your baby’s IQ and make a smarter baby');
    expect(g.allowed).toBe(false);
    expect(g.grade).toBe('Debunked');
    expect(g.rewrite).toBeTruthy();
  });

  it('blocks accelerated-bilingual claims (Contested)', () => {
    const g = groundClaim('these songs accelerate bilingual language acquisition');
    expect(g.allowed).toBe(false);
    expect(g.grade).toBe('Contested');
  });

  it('blocks Arabic/English acceleration claims (evidence absent)', () => {
    const g = groundClaim('Arabic and English songs speed up your child’s language');
    expect(g.allowed).toBe(false);
    expect(g.claim).toBeTruthy();
  });

  it('allows and grades a legitimate calming claim', () => {
    const g = groundClaim('gentle lullabies help calm and soothe infants');
    expect(g.allowed).toBe(true);
    expect(['Strong', 'Moderate']).toContain(g.grade);
  });

  it('catches over-claims written in the reversed / synonym phrasing', () => {
    // noun-before-adjective, alternate verbs, and "cognitive/brain development"
    expect(groundClaim('this song will make your baby smarter').allowed).toBe(false);
    expect(groundClaim('proven to raise your child’s IQ').allowed).toBe(false);
    expect(groundClaim('supports cognitive development in newborns').allowed).toBe(false);
    expect(groundClaim('helps your baby’s brain develop faster').allowed).toBe(false);
  });

  it('does not block legitimate bilingual EXPOSURE claims (only acceleration)', () => {
    expect(groundClaim('increase bilingual exposure at home with songs').allowed).toBe(true);
  });

  it('builds the graded claim set for a brief and always carries the recorded-ceiling caveat', () => {
    const claims = claimsForBrief({ goal: 'sleep', intent: 'developmental', stage: '0-3mo', windows: [], languages: ['en'] });
    expect(claims.some((c) => c.claim === RECORDED_CEILING_CAVEAT)).toBe(true);
    expect(claims.some((c) => c.grade === 'Strong' || c.grade === 'Moderate')).toBe(true);
  });

  it('emits no developmental claims for an entertainment brief', () => {
    expect(claimsForBrief({ goal: 'entertain', intent: 'entertainment', stage: '4-6yr', windows: [], languages: ['en'] })).toEqual([]);
  });

  it('carries an explicit blocked over-claim guardrail for bilingual Arabic/English briefs', () => {
    const claims = claimsForBrief({ goal: 'focus', intent: 'developmental', stage: '18-24mo', windows: [], languages: ['ar', 'en'] });
    expect(claims.some((c) => c.allowed === false)).toBe(true);
    expect(claims.some((c) => c.claim.includes('quantity') || c.grade === 'Strong')).toBe(true); // bilingual-exposure present
  });
});

describe('tool adapters', () => {
  const plan = selectParameters({ goal: 'sleep', stage: '0-3mo', envelope: STAGES_BY_ID['0-3mo'].allowedTempo });
  const lyrics = planLyrics({ goal: 'sleep', intent: 'developmental', stage: '0-3mo', languages: ['en'] });

  it('ElevenLabs emits a composition plan sized to the sections', () => {
    const el = toElevenLabs({ goal: 'sleep', plan, lyrics, lengthMs: 120_000 });
    expect(el.tool).toBe('elevenlabs');
    expect(el.forceInstrumental).toBe(false);
    expect(el.compositionPlan!.chunks.length).toBe(lyrics.sections.length);
    expect(el.compositionPlan!.chunks[0]!.positiveStyles.length).toBeLessThanOrEqual(7);
    expect(el.compositionPlan!.chunks.every((c) => c.durationMs >= 3000)).toBe(true);
    expect(el.musicLengthMs).toBeLessThanOrEqual(600_000);
  });

  it('ElevenLabs drops the plan and forces instrumental when lyrics are instrumental', () => {
    const inst = planLyrics({ goal: 'sleep', intent: 'developmental', stage: '0-3mo', languages: ['en'], instrumental: true });
    const el = toElevenLabs({ goal: 'sleep', plan, lyrics: inst, lengthMs: 60_000 });
    expect(el.forceInstrumental).toBe(true);
    expect(el.compositionPlan).toBeUndefined();
  });

  it('Suno keeps structure tags out of Style and inside Lyrics', () => {
    const s = toSuno({ goal: 'sleep', plan, lyrics });
    expect(s.style.includes('[')).toBe(false);
    expect(s.lyrics.includes('[')).toBe(true);
    expect(s.caveats.length).toBeGreaterThan(0);
  });

  it('Udio carries a verify-current-syntax caveat', () => {
    const u = toUdio({ goal: 'sleep', plan, lyrics });
    expect(u.caveats.join(' ')).toMatch(/verify/i);
  });
});

describe('specialist orchestrator', () => {
  it('produces an OK sleep brief for a newborn with graded claims and tool prompts', () => {
    const brief = composeChildMusicBrief({ text: 'help my newborn fall asleep', ageMonths: 1 });
    expect(brief.status).toBe('ok');
    expect(brief.goal.goal).toBe('sleep');
    expect(brief.stage.stage).toBe('0-3mo');
    expect(brief.prompts.elevenlabs.tool).toBe('elevenlabs');
    expect(brief.prompts.suno.tool).toBe('suno');
    expect(brief.prompts.udio.tool).toBe('udio');
    expect(brief.claims.some((c) => c.claim === RECORDED_CEILING_CAVEAT)).toBe(true);
    expect(brief.summary).toMatch(/sleep/);
  });

  it('blocks the brief when the speaker would be in the crib', () => {
    const brief = composeChildMusicBrief({ goal: 'sleep', ageMonths: 1, delivery: { speaker: 'crib' } });
    expect(brief.status).toBe('blocked');
    expect(brief.safety.blocks.length).toBeGreaterThan(0);
    // still carries the diagnostics + prompts so a caller can explain the block
    expect(brief.prompts.elevenlabs).toBeDefined();
  });

  it('carries the bilingual over-claim guardrail for an Arabic/English request', () => {
    const brief = composeChildMusicBrief({ goal: 'focus', ageMonths: 20, languages: ['ar', 'en'] });
    expect(brief.claims.some((c) => c.allowed === false)).toBe(true);
    expect(brief.lyrics.guidance.join(' ')).toMatch(/separate|code-mixing/i);
  });

  it('makes no developmental claims for an entertainment request', () => {
    const brief = composeChildMusicBrief({ goal: 'entertain', ageMonths: 60 });
    expect(brief.goal.intent).toBe('entertainment');
    expect(brief.claims).toEqual([]);
  });
});

describe('skill registry', () => {
  it('registers the specialist skills', () => {
    for (const name of [
      'child-music-router',
      'child-music-stage-profiler',
      'child-music-parameters',
      'child-music-safety',
      'child-music-evidence',
      'child-music-specialist',
    ]) {
      expect(hasSkill(name), `skill '${name}' should be registered`).toBe(true);
    }
  });
});
