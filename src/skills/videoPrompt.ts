// HIGHEST-LEVERAGE SKILL (Build-Spec §7). Turns a shot description into optimized,
// model-specific generation prompts for Runway, Kling, and Veo. Deterministic.
// v2 adds aspect ratio, negative prompts (all models), and a continuity seed so a
// recurring subject/look stays consistent across shots. Used by Visual Director (3).

export type GenModel = 'runway' | 'kling' | 'veo';
export type AspectRatio = '16:9' | '9:16' | '1:1';

export interface ShotSpec {
  description: string;
  style?: string;
  camera?: string;
  motion?: 'low' | 'medium' | 'high';
  duration_s?: number;
  mood?: string;
  negative?: string[];
  aspect?: AspectRatio;          // 16:9 long-form, 9:16 Shorts
  seed?: number;                 // continuity across shots of the same subject
  subjectRef?: string;           // short canonical subject description for consistency
}

const DEFAULTS = { style: 'photorealistic, cinematic', camera: 'slow dolly in', motion: 'medium' as const, duration_s: 4, mood: 'neutral', aspect: '16:9' as AspectRatio };

function clean(parts: (string | undefined)[]): string {
  return parts.filter(Boolean).map((p) => p!.trim()).filter(Boolean).join(', ').replace(/\s+,/g, ',');
}
function neg(spec: ShotSpec): string { return spec.negative?.length ? ` Avoid: ${spec.negative.join(', ')}.` : ''; }
function subject(spec: ShotSpec): string | undefined { return spec.subjectRef ? `consistent subject: ${spec.subjectRef}` : undefined; }

// Runway (Gen-3/4): scene-first, concise; "[camera]: [scene]. [style]."
function runwayPrompt(s: ShotSpec): string {
  const m = { ...DEFAULTS, ...s };
  return `${m.camera}: ${m.description}. ${clean([m.style, m.mood !== 'neutral' ? `${m.mood} mood` : undefined, subject(s), '24fps, shallow depth of field, natural lighting', `aspect ${m.aspect}`])}.${neg(s)}`;
}
// Kling: structured "[subject/action], [env], [style], [motion/quality]".
function klingPrompt(s: ShotSpec): string {
  const m = { ...DEFAULTS, ...s };
  const motionWord = m.motion === 'high' ? 'dynamic motion' : m.motion === 'low' ? 'subtle motion' : 'smooth motion';
  return clean([m.description, m.camera, m.style, subject(s), motionWord, `${m.duration_s}s`, `aspect ${m.aspect}`, 'high detail']) + neg(s);
}
// Veo: rich natural language, photoreal.
function veoPrompt(s: ShotSpec): string {
  const m = { ...DEFAULTS, ...s };
  return `A ${clean([m.style])} shot, ${m.aspect}. ${m.camera}. ${m.description}.${m.mood !== 'neutral' ? ` Mood: ${m.mood}.` : ''}${s.subjectRef ? ` Keep ${s.subjectRef} consistent.` : ''} Photorealistic, natural lighting, filmic color grade.${neg(s)}`;
}

export function videoPromptFor(model: GenModel, spec: ShotSpec): string {
  switch (model) {
    case 'runway': return runwayPrompt(spec);
    case 'kling': return klingPrompt(spec);
    case 'veo': return veoPrompt(spec);
  }
}

export interface ModelPrompts { runway: string; kling: string; veo: string; seed?: number }
export function videoPrompts(spec: ShotSpec): ModelPrompts {
  return { runway: videoPromptFor('runway', spec), kling: videoPromptFor('kling', spec), veo: videoPromptFor('veo', spec), seed: spec.seed };
}

// Back-compat simple signature.
export function videoPrompt(line: string, style: string, model: GenModel): string {
  return videoPromptFor(model, { description: line, style });
}
