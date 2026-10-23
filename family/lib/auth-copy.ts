/**
 * Plain words for the sign-in screens. No imports here: the node test runner loads this file.
 */

/** Supabase's error strings, said simply. */
export function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return "Wrong e-mail or password.";
  if (m.includes("email not confirmed")) return "Confirm your e-mail first: open the message we sent, then sign in.";
  if (m.includes("already registered") || m.includes("already been registered")) return "There is already an account for this e-mail. Sign in, or use “Forgot password”.";
  if (m.includes("rate limit")) return "Too many e-mails just now. Wait a little and try again.";
  if (m.includes("password should be")) return "Use at least 8 characters.";
  if (m.includes("failed to fetch")) return "No connection. Check the internet and try again.";
  // Google sign-in before the provider is switched on in Supabase (README, "Google sign-in").
  if (m.includes("provider is not enabled") || m.includes("unsupported provider")) return "Google sign-in is not switched on yet. Sign in with your e-mail for now.";
  return message;
}

/** What the sign-in screen says for `?error=` after a link or a Google sign-in did not finish. */
export function loginErrorText(code: string): string {
  if (code === "link") return "That link did not work. It may be old. Ask for a new one.";
  if (code === "google") return "Google sign-in did not finish. Try again, or sign in with your e-mail.";
  return code;
}

/**
 * The sign-in error code for what Supabase sent back to /auth/callback, or null when there
 * is none. An expired e-mail link comes back as `error_code=otp_expired`; a cancelled or
 * refused Google sign-in as `error=access_denied` with a provider code, so the screen can
 * say which instead of calling everything an old link.
 */
export function callbackErrorCode(params: { get(name: string): string | null }): string | null {
  const error = params.get("error");
  const code = params.get("error_code") ?? "";
  const why = (params.get("error_description") ?? "").toLowerCase();
  if (!error && !code) return null;
  if (code.startsWith("otp_") || why.includes("email link")) return "link";
  return "google";
}
