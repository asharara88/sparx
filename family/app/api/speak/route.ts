import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Me, RpcError } from "@/lib/types";
import { elevenSpeech, speechKey, speechText } from "@/lib/server/speech";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST { text } → the text read aloud as MP3, in the app's voice. Members only: every
 * call spends ElevenLabs credits. 503 when no voice is set up, and the phone speaks.
 */
export async function POST(req: Request) {
  if (!speechKey()) return NextResponse.json({ ok: false, error: "not_configured", message: "No voice is set up on the server." }, { status: 503 });
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ ok: false, error: "not_signed_in", message: "Sign in first." }, { status: 401 });
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me | RpcError | null;
  if (!me || !me.ok) return NextResponse.json({ ok: false, error: "no_member", message: "We could not load your details." }, { status: 403 });
  let text = "";
  try {
    text = speechText(((await req.json()) as { text?: unknown }).text);
  } catch {
    /* fallthrough */
  }
  if (!text) return NextResponse.json({ ok: false, error: "bad_request", message: "Nothing to read." }, { status: 400 });
  try {
    const up = await elevenSpeech(text, req.signal);
    if (!up.ok || !up.body) {
      const detail = await up.text().catch(() => "");
      console.error("speak failed", up.status, detail.slice(0, 300));
      return NextResponse.json({ ok: false, error: "failed", message: up.status === 401 ? "The voice key was refused." : up.status === 429 ? "Busy, try again in a minute." : "Could not read it out loud." }, { status: 502 });
    }
    return new Response(up.body, { status: 200, headers: { "content-type": "audio/mpeg", "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "failed", message: e instanceof Error ? e.message : "Could not read it out loud." }, { status: 502 });
  }
}
