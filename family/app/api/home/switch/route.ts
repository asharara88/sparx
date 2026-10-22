import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sameOrigin } from "@/lib/server/csrf";
import { HOME_COOKIE, HOME_COOKIE_MAX_AGE, homeId } from "@/lib/home-cookie";

export const dynamic = "force-dynamic";

/**
 * POST {household_id} → this device shows that home from now on. The database
 * records it as the account's chosen home (what a new device starts from) and
 * refuses a home the account is not in; the cookie binds this device's requests to
 * it (lib/home-cookie.ts). Other devices keep showing what they show.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req.headers, req.url)) return NextResponse.json({ ok: false, error: "cross_site" }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { household_id?: unknown } | null;
  const id = homeId(typeof body?.household_id === "string" ? body.household_id : null);
  if (!id) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  const supabase = await createClient({ ignorePreview: true });
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ ok: false, error: "not_signed_in" }, { status: 401 });
  const { data, error } = await supabase.rpc("home_switch", { p_household_id: id });
  if (error) return NextResponse.json({ ok: false, error: "failed", message: error.message }, { status: 500 });
  const res = data as { ok: boolean; error?: string; message?: string };
  if (!res.ok) return NextResponse.json(res, { status: res.error === "not_member" ? 403 : 400 });
  const out = NextResponse.json(res);
  out.cookies.set(HOME_COOKIE, id, { path: "/", maxAge: HOME_COOKIE_MAX_AGE, sameSite: "lax", secure: new URL(req.url).protocol === "https:" });
  return out;
}
