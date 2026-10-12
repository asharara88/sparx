import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Me, RpcError } from "@/lib/types";
import { briefKindNow, getBrief, type BriefKind } from "@/lib/assistant/brief";
import { friendlyModelError } from "@/lib/server/anthropic";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** GET ?kind=morning|evening&refresh=1 → today's brief for the caller (generated on first ask). */
export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ ok: false, error: "not_signed_in", message: "Sign in first." }, { status: 401 });
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me | RpcError | null;
  if (!me || !me.ok) return NextResponse.json({ ok: false, error: "no_member", message: "We could not load your details." }, { status: 403 });

  const url = new URL(req.url);
  const kindParam = url.searchParams.get("kind");
  const kind: BriefKind = kindParam === "morning" || kindParam === "evening" ? kindParam : briefKindNow(me.household.timezone);
  const refresh = url.searchParams.get("refresh") === "1";
  try {
    const res = await getBrief(supabase, me, kind, refresh);
    return NextResponse.json(res, { status: res.ok ? 200 : res.error === "not_allowed" ? 403 : 503 });
  } catch (e) {
    console.error("brief:", e);
    const f = friendlyModelError(e);
    return NextResponse.json({ ok: false, error: f.setup ? "not_configured" : "failed", message: f.message }, { status: f.setup ? 503 : 502 });
  }
}
