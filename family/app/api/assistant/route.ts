import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { AssistantEvent, AssistantTurn, Me, RpcError } from "@/lib/types";
import { askAssistant } from "@/lib/assistant/run";
import { friendlyModelError } from "@/lib/server/anthropic";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SCREENS = new Set(["home", "lana", "patterns", "milk", "plan", "calendar", "shopping", "simple"]);

/**
 * POST { question, turns?, screen?, stream? }.
 * Without stream: an AssistantReply (or RpcError) as JSON.
 * With stream: NDJSON, one AssistantEvent per line (status, delta, reset, done | error).
 * Runs with the caller's own Supabase session, so RLS decides what it may see.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ ok: false, error: "not_signed_in", message: "Sign in first." }, { status: 401 });
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me | RpcError | null;
  if (!me || !me.ok) return NextResponse.json({ ok: false, error: "no_member", message: "We could not load your details." }, { status: 403 });

  let body: { question?: unknown; turns?: unknown; screen?: unknown; stream?: unknown };
  try {
    body = (await req.json()) as typeof body;
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
  const screen = typeof body.screen === "string" && SCREENS.has(body.screen) ? body.screen : null;

  // Ending the conversation on the phone aborts the fetch; the signal reaches the model
  // stream and the tools, so nothing goes on being computed for an answer nobody will read.
  const stop = new AbortController();
  req.signal?.addEventListener("abort", () => stop.abort(), { once: true });

  if (body.stream !== true) {
    try {
      const reply = await askAssistant({ supabase, me, turns, question, screen, signal: stop.signal });
      return NextResponse.json(reply, { status: reply.ok ? 200 : reply.error === "not_allowed" ? 403 : reply.error === "cancelled" ? 499 : 503 });
    } catch (e) {
      console.error("assistant:", e);
      const f = friendlyModelError(e);
      return NextResponse.json({ ok: false, error: f.setup ? "not_configured" : "failed", message: f.message }, { status: f.setup ? 503 : 502 });
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (e: AssistantEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
        } catch {
          open = false;
        }
      };
      try {
        const reply = await askAssistant({ supabase, me, turns, question, screen, signal: stop.signal, onEvent: (e) => e.type !== "done" && send(e) });
        if (reply.ok) send({ type: "done", reply });
        else send({ type: "error", error: reply.error, message: reply.message ?? "The assistant could not answer." });
      } catch (e) {
        console.error("assistant:", e);
        const f = friendlyModelError(e);
        send({ type: "error", error: f.setup ? "not_configured" : "failed", message: f.message });
      } finally {
        open = false;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      // The reader went away (End tapped, tab closed): stop the model and the tools.
      stop.abort();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
}
