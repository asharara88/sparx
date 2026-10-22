/**
 * The home a device is showing. The app keeps it in a cookie per device and sends
 * it with every request as the x-home header; the database runs the request as the
 * account's member row in that home, and only if the account is in it. So a switch
 * on one phone never moves another phone's next write (docs/MULTI_HOME.md).
 */
export const HOME_COOKIE = "elnunu_home";
export const HOME_HEADER = "x-home";
export const HOME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The id when it is a uuid, else null: a cookie is never trusted blindly. */
export function homeId(v: string | null | undefined): string | null {
  return v && UUID.test(v) ? v.toLowerCase() : null;
}
