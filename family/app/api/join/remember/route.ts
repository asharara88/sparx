import { NextResponse } from "next/server";
import { sameOrigin } from "@/lib/server/csrf";
import { JOIN_COOKIE, JOIN_COOKIE_MAX_AGE, inviteToken } from "@/lib/join";

export const dynamic = "force-dynamic";

/**
 * POST {token} → this device remembers the invite it is on for an hour, so a sign-in
 * by e-mail link (which lands on /auth/callback) comes back to the join screen.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req.headers, req.url)) return NextResponse.json({ ok: false, error: "cross_site" }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { token?: unknown } | null;
  const token = inviteToken(typeof body?.token === "string" ? body.token : null);
  if (!token) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  const out = NextResponse.json({ ok: true });
  out.cookies.set(JOIN_COOKIE, token, { path: "/", maxAge: JOIN_COOKIE_MAX_AGE, httpOnly: true, sameSite: "lax", secure: new URL(req.url).protocol === "https:" });
  return out;
}
