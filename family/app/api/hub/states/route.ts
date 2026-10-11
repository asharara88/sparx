import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { HubEntity, Me, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { hubConfigured, hubStates } from "@/lib/hub/ha";

export const dynamic = "force-dynamic";

/** GET → states of the configured hub entities; ?all=1 (admins) lists every entity to pick from. */
export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ ok: false, error: "not_signed_in" }, { status: 401 });
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me | RpcError | null;
  if (!me || !me.ok || !can(me, "maintenance", "view")) return NextResponse.json({ ok: false, error: "not_allowed", message: "Not for your role." }, { status: 403 });
  if (!hubConfigured()) return NextResponse.json({ ok: false, error: "not_configured", message: "No Home Assistant hub is connected yet." }, { status: 503 });
  const all = new URL(req.url).searchParams.get("all") === "1" && can(me, "members", "edit");
  const { data: ents } = await supabase.from("hub_entities").select("*").eq("is_active", true).order("sort");
  try {
    const states = await hubStates(((ents as HubEntity[] | null) ?? []), all);
    return NextResponse.json({ ok: true, states, configured: ((ents as HubEntity[] | null) ?? []).length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "hub_error", message: e instanceof Error ? e.message : "Could not reach the hub." }, { status: 502 });
  }
}
