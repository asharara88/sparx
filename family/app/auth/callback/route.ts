import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { JOIN_COOKIE, afterSignIn } from "@/lib/join";
import { callbackErrorCode } from "@/lib/auth-copy";

/**
 * E-mail link landing (confirm, reset, one-time link) and the way back from Google: turns
 * the code / token into a session cookie. A refused or cancelled Google sign-in comes back
 * with `error=` instead of a code; the device keeps its invite cookie so a second try, by
 * Google or by e-mail, still lands on the join screen.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const refused = callbackErrorCode(url.searchParams);
  if (refused) return NextResponse.redirect(new URL(`/login?error=${refused}`, url.origin));
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
  return NextResponse.redirect(new URL("/login?error=link", url.origin));
}
