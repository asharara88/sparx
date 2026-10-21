import { NextResponse } from "next/server";
import { cronAuthorized, cronConfigured } from "@/lib/server/member";
import { runOften } from "@/lib/push/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Vercel cron, every few minutes on a plan that allows it: event reminders, new requests, urgent tickets. */
export async function GET(req: Request) {
  // No secret set means the cron is not configured, not that the caller is wrong.
  if (!process.env.CRON_SECRET) return NextResponse.json({ ok: false, error: "not_configured", missing: ["CRON_SECRET"] }, { status: 503 });
  if (!cronAuthorized(req)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const cfg = cronConfigured();
  if (!cfg.ok) return NextResponse.json({ ok: false, error: "not_configured", missing: cfg.missing }, { status: 503 });
  try {
    const report = await runOften();
    return NextResponse.json({ ok: true, ...report });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "failed", message: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
