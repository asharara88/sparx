/**
 * Is this request from our own pages? Form posts carry the session cookie across
 * sites (SameSite=Lax sends it on a top-level POST), so a hostile page could sign the
 * admin out or drop them into "view as". Browsers mark cross-site requests with
 * Sec-Fetch-Site, and send Origin on every POST; either is enough to refuse.
 * No dependencies, so the node test runner can exercise it.
 */
export function sameOrigin(headers: { get(name: string): string | null }, requestUrl: string): boolean {
  const site = headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).origin === new URL(requestUrl).origin;
    } catch {
      return false;
    }
  }
  return true;
}
