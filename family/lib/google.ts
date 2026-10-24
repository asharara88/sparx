/**
 * "Sign in with Google" through Google Identity Services (GIS), the button Google draws
 * itself on elnunu.com. Google then shows *elnunu.com* on its screen and posts an ID token
 * straight to /auth/google, so the Supabase project's address never appears to the family.
 * Without a client id the app falls back to Supabase's redirect flow (components/GoogleButton).
 * No imports here: the node test runner loads this file.
 */

/** The OAuth client id Google's button needs in the browser; empty means "use the fallback". */
export const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

/** Where Google posts the ID token (ux_mode "redirect"); must be an authorized redirect URI of the client. */
export const GOOGLE_LOGIN_PATH = "/auth/google";

/** Google's cookie and form field for its double-submit check on that post. */
export const GOOGLE_CSRF = "g_csrf_token";

/** Google's button accepts a pixel width between 200 and 400; the card decides within that. */
export function googleButtonWidth(containerPx: number): number {
  if (!Number.isFinite(containerPx) || containerPx <= 0) return 320;
  return Math.max(200, Math.min(400, Math.round(containerPx)));
}

/** The double-submit check Google asks for: the cookie it set and the field it posted must match. */
export function csrfMatches(cookie: string | null | undefined, field: FormDataEntryValue | null | undefined): boolean {
  return typeof field === "string" && !!cookie && field.length > 0 && cookie === field;
}

/** The ID token from Google's post, when it looks like one (three base64url parts). */
export function credentialFrom(field: FormDataEntryValue | null | undefined): string | null {
  return typeof field === "string" && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(field) ? field : null;
}
