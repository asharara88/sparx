import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sameOrigin } from "@/lib/server/csrf";
import { PREVIEW_COOKIE } from "@/lib/server/preview";
import { HOME_COOKIE } from "@/lib/home-cookie";

export async function POST(request: Request) {
  // Only our own Sign out button; a hostile page must not be able to sign the member out.
  if (!sameOrigin(request.headers, request.url)) return NextResponse.json({ ok: false, error: "cross_site" }, { status: 403 });
  const supabase = await createClient({ ignorePreview: true });
  await supabase.auth.signOut();
  const res = NextResponse.redirect(new URL("/login", new URL(request.url).origin), { status: 303 });
  res.cookies.set(PREVIEW_COOKIE, "", { path: "/", maxAge: 0 });
  // The home this device showed goes too: the next account to sign in here starts from its own choice.
  res.cookies.set(HOME_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
