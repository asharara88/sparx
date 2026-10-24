import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { JOIN_COOKIE, afterSignIn, inviteToken, joinPath } from "@/lib/join";
import { GOOGLE_CSRF, credentialFrom, csrfMatches } from "@/lib/google";

export const dynamic = "force-dynamic";

/** The sign-in screen this device should see a failure on: the invite it was on, else login. */
function failedTo(origin: string, join: string | undefined, reason: "google" | "google_off"): NextResponse {
  const token = inviteToken(join);
  return NextResponse.redirect(new URL(`${token ? joinPath(token) : "/login"}?error=${reason}`, origin), 303);
}

/**
 * Where Google's own button posts the ID token (components/GoogleButton, ux_mode
 * "redirect"). The token becomes a Supabase session here, server side; nothing of the
 * Supabase project is ever shown to the person. Google's post is cross-site, so this
 * device's own cookies (the invite it was on) are not on it: the answer is a redirect to
 * the GET below, a same-site step that has them.
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const form = await request.formData().catch(() => null);
  const jar = await cookies();
  const back = (reason: "google" | "google_off") => NextResponse.redirect(new URL(`/auth/google?error=${reason}`, url.origin), 303);
  if (!form || !csrfMatches(jar.get(GOOGLE_CSRF)?.value, form.get(GOOGLE_CSRF))) return back("google");
  const token = credentialFrom(form.get("credential"));
  if (!token) return back("google");
  const supabase = await createClient({ ignorePreview: true });
  const { error } = await supabase.auth.signInWithIdToken({ provider: "google", token });
  if (error) return back(/provider is not enabled|unsupported provider/i.test(error.message) ? "google_off" : "google");
  return NextResponse.redirect(new URL("/auth/google", url.origin), 303);
}

/** The same-site landing after the post: signed in, go where an e-mail link would; else say so. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const jar = await cookies();
  const join = jar.get(JOIN_COOKIE)?.value;
  const reason = url.searchParams.get("error");
  if (reason === "google_off" || reason === "google") return failedTo(url.origin, join, reason);
  const supabase = await createClient({ ignorePreview: true });
  const { data } = await supabase.auth.getUser();
  if (!data.user) return failedTo(url.origin, join, "google");
  const res = NextResponse.redirect(new URL(afterSignIn("/", join), url.origin), 303);
  if (join) res.cookies.set(JOIN_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
