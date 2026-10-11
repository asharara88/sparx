import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Me, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { hubCamera, hubConfigured } from "@/lib/hub/ha";

export const dynamic = "force-dynamic";

/** GET → a still from a configured camera entity. The token never leaves the server. */
export async function GET(_req: Request, { params }: { params: Promise<{ entity: string }> }) {
  const { entity } = await params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ ok: false, error: "not_signed_in" }, { status: 401 });
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me | RpcError | null;
  if (!me || !me.ok || !can(me, "maintenance", "view")) return NextResponse.json({ ok: false, error: "not_allowed" }, { status: 403 });
  if (!hubConfigured()) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  const { data: ent } = await supabase.from("hub_entities").select("entity_id").eq("entity_id", entity).eq("is_active", true).maybeSingle();
  if (!ent) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  try {
    const { bytes, type } = await hubCamera(entity);
    return new NextResponse(bytes, { headers: { "content-type": type, "cache-control": "private, max-age=10" } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "hub_error", message: e instanceof Error ? e.message : "Could not reach the hub." }, { status: 502 });
  }
}
