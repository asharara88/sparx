import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { JOIN_COOKIE, afterSignIn, inviteToken, joinPath } from "@/lib/join";

/**
 * Where a failed sign-in lands, with a reason the screen can put into words: the invite
 * screen the device was on when there is one, else the login page. A Google tap that
 * fails on Supabase's side comes back here with the error in the query (the browser had
 * already left for Supabase's authorize endpoint), not as an error in the app: the
 * provider off is one case, a wrong client secret ("Unable to exchange external code")
 * another; neither is an old e-mail link, so the screen says "Google sign-in did not
 * finish" rather than "that link did not work".
 */
function failed(origin: string, join: string | undefined, description: string | null): NextResponse {
  const reason = !description ? "link" : /provider is not enabled|unsupported provider/i.test(description) ? "google_off" : "google";
  const token = inviteToken(join);
  return NextResponse.redirect(new URL(`${token ? joinPath(token) : "/login"}?error=${reason}`, origin));
}

/** E-mail link landing (confirm, reset, one-time link): turns the code / token into a session cookie. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  let next = url.searchParams.get("next") ?? "/";
  if (!next.startsWith("/") || next.startsWith("//")) next = "/";
  // A password-reset link always lands on the password page, whatever redirect_to carried:
  // Supabase only honours redirect URLs that match its allow-list exactly, so no query strings.
  if (type === "recovery") next = "/me/password?reset=1";
  // A device that was on an invite link goes back to it once signed in (lib/join.ts).
  const join = (await cookies()).get(JOIN_COOKIE)?.value;
  next = afterSignIn(next, join);
  const supabase = await createClient();
  const description = url.searchParams.get("error_description") ?? url.searchParams.get("error_code") ?? url.searchParams.get("error");

  const landed = () => {
    const res = NextResponse.redirect(new URL(next, url.origin));
    if (join) res.cookies.set(JOIN_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  };
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return landed();
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return landed();
  }
  return failed(url.origin, join, description);
}
