/**
 * Joining a home by invite link (migration 5300). The link is /join/<token>. Opening it
 * signed out shows the home and the name waiting, with sign-in on the same screen; the
 * token is kept in a short-lived cookie meanwhile, so an e-mail link (which lands on
 * /auth/callback with no query of its own: Supabase honours only redirect URLs that
 * match its allow-list exactly) comes back to the join screen. No imports here: the
 * node test runner loads this file.
 */
export const JOIN_COOKIE = "elnunu_join";
export const JOIN_COOKIE_MAX_AGE = 60 * 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The token when it is a uuid, else null: a cookie or path segment is never trusted blindly. */
export function inviteToken(v: string | null | undefined): string | null {
  return v && UUID.test(v) ? v.toLowerCase() : null;
}

export function joinPath(token: string): string {
  return `/join/${token}`;
}

/** The page an e-mail link lands on next: the join screen the device was on, else `next`. */
export function afterSignIn(next: string, joinCookie: string | null | undefined): string {
  const token = inviteToken(joinCookie);
  return token && next === "/" ? joinPath(token) : next;
}
