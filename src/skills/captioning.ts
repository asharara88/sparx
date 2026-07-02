import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineSkill } from './registry.js';

// Real caption generation (replaces the captioningAssembly stub that hardcoded
// captioned:true). Builds timed cues from the narration text + per-section clip
// durations, splitting long sections into readable multi-cue chunks, and writes
// standard SRT + WebVTT files that publishing can upload as a caption track.

export interface CaptionSection {
  text: string;        // narration for this section
  startS: number;      // section start on the master timeline
  durationS: number;   // section duration
}

export interface CaptionCue { startS: number; endS: number; text: string }

export interface CaptionResult {
  srt_uri: string;
  vtt_uri: string;
  cue_count: number;
}

const MAX_CUE_CHARS = 84;   // ~2 lines of 42 chars, YouTube-comfortable
const MIN_CUE_S = 1.0;

/** Split section text into cue-sized chunks on sentence/word boundaries. */
export function chunkText(text: string, maxChars = MAX_CUE_CHARS): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let cur = '';
  for (const w of words) {
    const candidate = cur ? `${cur} ${w}` : w;
    if (candidate.length > maxChars && cur) {
      chunks.push(cur);
      cur = w;
    } else {
      cur = candidate;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/**
 * Lay section text over its time range, weighting each cue by its share of
 * characters. Cues never cross their section boundary (the next section's first
 * cue starts there) — when the remaining time is too short for another readable
 * cue, the text merges into the previous cue instead of overflowing.
 */
export function buildCues(sections: CaptionSection[]): CaptionCue[] {
  const cues: CaptionCue[] = [];
  for (const s of sections) {
    const chunks = chunkText(s.text);
    if (!chunks.length || s.durationS <= 0) continue;
    const sectionEnd = s.startS + s.durationS;
    const totalChars = chunks.reduce((n, c) => n + c.length, 0);
    let t = s.startS;
    let firstOfSection = cues.length;
    for (const chunk of chunks) {
      const prev = cues[cues.length - 1];
      if (sectionEnd - t < MIN_CUE_S && cues.length > firstOfSection && prev) {
        // no room for another readable cue — fold the text into the last one
        prev.text = `${prev.text} ${chunk}`;
        prev.endS = sectionEnd;
        continue;
      }
      const span = Math.max(MIN_CUE_S, (chunk.length / totalChars) * s.durationS);
      const end = Math.min(t + span, sectionEnd);
      cues.push({ startS: t, endS: end, text: chunk });
      t = end;
    }
  }
  return cues;
}

function pad(n: number, w = 2) { return String(n).padStart(w, '0'); }

function stamp(seconds: number, sep: ',' | '.'): string {
  const ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000), s = Math.floor((ms % 60_000) / 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms % 1000, 3)}`;
}

export function toSRT(cues: CaptionCue[]): string {
  return cues.map((c, i) => `${i + 1}\n${stamp(c.startS, ',')} --> ${stamp(c.endS, ',')}\n${c.text}\n`).join('\n') + '\n';
}

export function toVTT(cues: CaptionCue[]): string {
  return 'WEBVTT\n\n' + cues.map((c) => `${stamp(c.startS, '.')} --> ${stamp(c.endS, '.')}\n${c.text}\n`).join('\n') + '\n';
}

/** Build cue files for an episode and persist them under generated/<episode>/. */
export async function writeCaptions(episodeId: string, sections: CaptionSection[]): Promise<CaptionResult> {
  const cues = buildCues(sections);
  const dir = join('generated', episodeId);
  mkdirSync(dir, { recursive: true });
  const srt = join(dir, 'captions.srt');
  const vtt = join(dir, 'captions.vtt');
  writeFileSync(srt, toSRT(cues));
  writeFileSync(vtt, toVTT(cues));
  return { srt_uri: srt, vtt_uri: vtt, cue_count: cues.length };
}

export const captioningSkill = defineSkill<{ episodeId: string; sections: CaptionSection[] }, CaptionResult>({
  name: 'captioning',
  description: 'Generate timed SRT + WebVTT caption files from narration text and per-section timeline durations.',
  run: async ({ episodeId, sections }) => writeCaptions(episodeId, sections),
});
