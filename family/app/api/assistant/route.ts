import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { AssistantTurn, Me, RpcError } from "@/lib/types";
import { askAssistant } from "@/lib/assistant/run";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** POST { question, turns? } → AssistantReply. Runs with the caller's own Supabase session. */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ ok: false, error: "not_signed_in", message: "Sign in first." }, { status: 401 });
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me | RpcError | null;
  if (!me || !me.ok) return NextResponse.json({ ok: false, error: "no_member", message: "We could not load your details." }, { status: 403 });

  let body: { question?: unknown; turns?: unknown };
  try {
    body = (await req.json()) as { question?: unknown; turns?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request", message: "Send a question." }, { status: 400 });
  }
  const question = typeof body.question === "string" ? body.question.trim().slice(0, 2000) : "";
  if (!question) return NextResponse.json({ ok: false, error: "bad_request", message: "Send a question." }, { status: 400 });
  const turns: AssistantTurn[] = Array.isArray(body.turns)
    ? (body.turns as unknown[])
        .filter((t): t is AssistantTurn => !!t && typeof t === "object" && ((t as AssistantTurn).role === "user" || (t as AssistantTurn).role === "assistant") && typeof (t as AssistantTurn).text === "string")
        .map((t) => ({ role: t.role, text: t.text.slice(0, 4000) }))
    : [];

  try {
    const reply = await askAssistant({ supabase, me, turns, question });
    return NextResponse.json(reply, { status: reply.ok ? 200 : reply.error === "not_allowed" ? 403 : 503 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "The assistant could not answer.";
    return NextResponse.json({ ok: false, error: "failed", message }, { status: 502 });
  }
}
