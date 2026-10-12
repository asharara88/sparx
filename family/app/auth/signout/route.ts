import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { PREVIEW_COOKIE } from "@/lib/server/preview";

export async function POST(request: Request) {
  const supabase = await createClient({ ignorePreview: true });
  await supabase.auth.signOut();
  const res = NextResponse.redirect(new URL("/login", new URL(request.url).origin), { status: 303 });
  res.cookies.set(PREVIEW_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
