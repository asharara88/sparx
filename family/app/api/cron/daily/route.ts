import { NextResponse } from "next/server";
import { cronAuthorized, cronConfigured } from "@/lib/server/member";
import { runDaily } from "@/lib/push/cron";
import { runBackup } from "@/lib/backup/run";
import { runHomeCleanups } from "@/lib/server/cleanup";
import { serviceClient } from "@/lib/server/member";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Vercel cron, early morning: briefs, suggestions, Sunday plan. Needs CRON_SECRET. */
export async function GET(req: Request) {
  // No secret set means the cron is not configured, not that the caller is wrong.
  if (!process.env.CRON_SECRET) return NextResponse.json({ ok: false, error: "not_configured", missing: ["CRON_SECRET"] }, { status: 503 });
  if (!cronAuthorized(req)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const cfg = cronConfigured();
  if (!cfg.ok) return NextResponse.json({ ok: false, error: "not_configured", missing: cfg.missing }, { status: 503 });
  try {
    const report = await runDaily();
    // The nightly backup rides the same cron; a failure there must not hide the push report.
    let backup: unknown;
    try {
      backup = await runBackup();
    } catch (e) {
      backup = { error: e instanceof Error ? e.message : String(e) };
    }
    // The file cleanup of deleted homes that did not finish at the time (lib/server/cleanup.ts).
    let cleanups: unknown;
    try {
      cleanups = await runHomeCleanups(serviceClient());
    } catch (e) {
      cleanups = { error: e instanceof Error ? e.message : String(e) };
    }
    return NextResponse.json({ ok: true, ...report, backup, cleanups });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "failed", message: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
