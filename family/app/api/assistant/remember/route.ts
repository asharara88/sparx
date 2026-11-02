import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Me, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { rememberEnabled, rememberFromChat } from "@/lib/assistant/remember-run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST { chat }: read one of the caller's saved chats for things worth
 * remembering, and store them as suggestions. Answers { ok, off: true } while
 * ASSISTANT_REMEMBER is not set, so the screen can call it without checking.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ ok: false, error: "not_signed_in", message: "Sign in first." }, { status: 401 });
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me | RpcError | null;
  if (!me || !me.ok) return NextResponse.json({ ok: false, error: "no_member" }, { status: 403 });
  if (!can(me, "assistant", "view")) return NextResponse.json({ ok: false, error: "not_allowed" }, { status: 403 });
  if (!rememberEnabled()) return NextResponse.json({ ok: true, off: true });
  let body: { chat?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  const chat = typeof body.chat === "string" && /^[0-9a-f-]{36}$/.test(body.chat) ? body.chat : null;
  if (!chat) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  try {
    const r = await rememberFromChat(supabase, me, chat);
    return NextResponse.json(r, { status: r.ok ? 200 : r.error === "not_found" ? 404 : 502 });
  } catch (e) {
    console.error("remember:", e);
    return NextResponse.json({ ok: false, error: "failed" }, { status: 502 });
  }
}
