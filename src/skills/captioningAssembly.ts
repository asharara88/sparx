// clips + vo + music -> captioned timeline. Used by Editor (7).
export async function captioningAssembly(input: { clips: string[]; vo: string[]; music: string }): Promise<{ timelineUri: string; captioned: boolean }> {
  return { timelineUri: 'mock://edit/timeline.json', captioned: true };
}
