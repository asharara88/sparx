import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Me, RpcError } from "@/lib/types";
import { draftPlan } from "@/lib/plan/draft";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** POST → drafts next week's plan as a suggestion card for the caller. */
export async function POST() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ ok: false, error: "not_signed_in", message: "Sign in first." }, { status: 401 });
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me | RpcError | null;
  if (!me || !me.ok) return NextResponse.json({ ok: false, error: "no_member", message: "We could not load your details." }, { status: 403 });
  try {
    const res = await draftPlan(supabase, me);
    return NextResponse.json(res, { status: res.ok ? 200 : res.error === "not_allowed" ? 403 : res.error === "not_configured" ? 503 : 422 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "failed", message: e instanceof Error ? e.message : "Could not draft the plan." }, { status: 502 });
  }
}
