import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Me, RpcError } from "@/lib/types";
import { parseCartReport } from "@/lib/shopping/cart";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST { id, text } → the agent's pasted summary as a per-item report (not saved). */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ ok: false, error: "not_signed_in", message: "Sign in first." }, { status: 401 });
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me | RpcError | null;
  if (!me || !me.ok) return NextResponse.json({ ok: false, error: "no_member", message: "We could not load your details." }, { status: 403 });
  let body: { id?: unknown; text?: unknown } = {};
  try {
    body = (await req.json()) as { id?: unknown; text?: unknown };
  } catch {
    /* fallthrough */
  }
  const id = String(body.id ?? "");
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!/^[0-9a-f-]{36}$/.test(id) || !text) return NextResponse.json({ ok: false, error: "bad_request", message: "Paste the agent's report." }, { status: 400 });
  try {
    const res = await parseCartReport(supabase, me, id, text);
    return NextResponse.json(res, { status: res.ok ? 200 : res.error === "not_allowed" ? 403 : res.error === "not_configured" ? 503 : 422 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "failed", message: e instanceof Error ? e.message : "Could not read the report." }, { status: 502 });
  }
}
