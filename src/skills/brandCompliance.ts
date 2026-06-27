// artifact -> compliance verdict. Used by QA (12).
export async function brandCompliance(artifact: unknown): Promise<{ voiceOk: boolean; bannedClaims: string[]; licenseOk: boolean; aiLabelNeeded: boolean }> {
  return { voiceOk: true, bannedClaims: [], licenseOk: true, aiLabelNeeded: true };
}
