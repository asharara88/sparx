import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Me, RpcError } from "@/lib/types";
import { readMilkPhoto } from "@/lib/milk/scan";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST { image: data URL } → what is written on the bag or shown on the bottle. */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ ok: false, error: "not_signed_in", message: "Sign in first." }, { status: 401 });
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me | RpcError | null;
  if (!me || !me.ok) return NextResponse.json({ ok: false, error: "no_member", message: "We could not load your details." }, { status: 403 });
  let image = "";
  try {
    image = String(((await req.json()) as { image?: unknown }).image ?? "");
  } catch {
    /* fallthrough */
  }
  if (!image.startsWith("data:image/")) return NextResponse.json({ ok: false, error: "bad_request", message: "No photo." }, { status: 400 });
  try {
    const res = await readMilkPhoto(supabase, me, image);
    return NextResponse.json(res, { status: res.ok ? 200 : res.error === "not_allowed" ? 403 : res.error === "not_configured" ? 503 : 422 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "failed", message: e instanceof Error ? e.message : "Could not read the photo." }, { status: 502 });
  }
}
