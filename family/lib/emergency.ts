/**
 * The child's ambulance number, from the profile (emergency_ambulance), or null when
 * the family has not given one. Nothing is assumed: a home outside the UAE must not
 * be told to call 998. New homes get it from their time zone where the number is
 * certain (migration 5700); everyone else types it on the emergency card.
 */
export function ambulanceOf(profile: Record<string, unknown> | null | undefined): string | null {
  const v = profile?.emergency_ambulance;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
