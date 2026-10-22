/**
 * The home a device is showing. The app keeps it in a cookie per device and sends
 * it with every request as the x-home header; the database runs the request as the
 * account's member row in that home, and refuses the request when the account is
 * not in it. So a switch on one phone never moves another phone's next write, and a
 * tab bound to one home never writes into the home another tab switched the cookie
 * to (docs/MULTI_HOME.md). No imports here: the node test runner loads this file.
 */
export const HOME_COOKIE = "elnunu_home";
export const HOME_HEADER = "x-home";
export const HOME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The id when it is a uuid, else null: a cookie or header is never trusted blindly. */
export function homeId(v: string | null | undefined): string | null {
  return v && UUID.test(v) ? v.toLowerCase() : null;
}

/**
 * The home a request on the server runs as: the one the page named in its header
 * (a tab bound to home A keeps saying A whatever the cookie says now), else the
 * one this device's cookie keeps, else none (the account's chosen home applies).
 */
export function resolveHome(header: string | null | undefined, cookie: string | null | undefined): string | null {
  return homeId(header) ?? homeId(cookie);
}

/** `init` with the home on the request, unless it already names one (a queued entry's replay names its own). */
export function withHome(init: RequestInit | undefined, home: string | null): RequestInit | undefined {
  if (!home) return init;
  const headers = new Headers(init?.headers);
  if (!headers.has(HOME_HEADER)) headers.set(HOME_HEADER, home);
  return { ...init, headers };
}
