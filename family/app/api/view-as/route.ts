import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Me, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { PREVIEW_COOKIE, PREVIEW_TTL_SECONDS, mintPreviewToken, previewConfigured } from "@/lib/server/preview";

/**
 * POST member_id=<uuid>  → start viewing the app as that member (admins only).
 * POST exit=1            → back to yourself.
 * Form posts, so the Members page needs no JavaScript for it.
 */
export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  const form = await request.formData();
  if (form.get("exit")) {
    const res = NextResponse.redirect(new URL("/members", origin), { status: 303 });
    res.cookies.set(PREVIEW_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  }
  if (!previewConfigured()) return NextResponse.redirect(new URL("/members?error=preview", origin), { status: 303 });

  const supabase = await createClient({ ignorePreview: true });
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.redirect(new URL("/login", origin), { status: 303 });
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me | RpcError | null;
  if (!me || !me.ok || !can(me, "members", "edit")) return NextResponse.redirect(new URL("/", origin), { status: 303 });

  const memberId = String(form.get("member_id") ?? "");
  const { data: target } = await supabase.from("members").select("id, is_active").eq("id", memberId).maybeSingle();
  if (!target || !target.is_active) return NextResponse.redirect(new URL("/members?error=member", origin), { status: 303 });

  const token = await mintPreviewToken(target.id as string, auth.user.id);
  const res = NextResponse.redirect(new URL("/", origin), { status: 303 });
  // Not HttpOnly on purpose: the browser client reads it so client components see the same view.
  res.cookies.set(PREVIEW_COOKIE, token, { path: "/", maxAge: PREVIEW_TTL_SECONDS, sameSite: "lax", secure: origin.startsWith("https") });
  return res;
}
