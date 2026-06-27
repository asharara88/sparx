// script_line -> ranked stock/image candidates. Used by Asset Sourcing (6).
export async function assetMatching(line: string): Promise<{ uri: string; score: number }[]> {
  return [{ uri: `mock://stock/${encodeURIComponent(line).slice(0, 16)}.mp4`, score: 0.5 }];
}
