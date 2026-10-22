import { NextResponse } from "next/server";
import { cronAuthorized, serviceClient } from "@/lib/server/member";
import { runDaily } from "@/lib/push/cron";
import { runBackup } from "@/lib/backup/run";
import { runHomeCleanups } from "@/lib/server/cleanup";
import { allWell, runJob, type JobOutcome } from "@/lib/jobs";
import { recordRun } from "@/lib/server/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Vercel cron, early morning. Four jobs, run apart: the pushes (briefs, open
 * suggestions, the Sunday plan), the nightly backup of every home, the file
 * cleanup of deleted homes, and the timers left on. Each has its own configuration check and its own
 * failure: a missing push key or a thrown push error never stops the backup or
 * the cleanups. Each job's last run is recorded in job_runs (the Audit screen
 * shows it). Needs CRON_SECRET.
 */
export async function GET(req: Request) {
  // No secret set means the cron is not configured, not that the caller is wrong.
  if (!process.env.CRON_SECRET)
    return NextResponse.json(
      { ok: false, error: "not_configured", missing: ["CRON_SECRET"] },
      { status: 503 },
    );
  if (!cronAuthorized(req))
    return NextResponse.json(
      { ok: false, error: "forbidden" },
      { status: 403 },
    );
  const env = process.env;

  const outcomes: JobOutcome[] = [];
  outcomes.push(
    await runJob("pushes", env, async () => {
      const r = await runDaily();
      return {
        report: {
          members: r.members,
          sent: r.sent,
          skipped: r.skipped,
          errors: r.errors,
          detail: r.detail,
        },
        error: r.errors.length
          ? `${r.errors.length} of ${r.members} failed; first: ${r.errors[0]}`
          : undefined,
      };
    }),
  );
  outcomes.push(
    await runJob("backup", env, async () => {
      const r = await runBackup();
      return {
        report: {
          rows: r.rows,
          size: r.size,
          photos: r.photos,
          removed: r.removed,
          homes: Object.keys(r.homes).length,
        },
      };
    }),
  );
  outcomes.push(
    await runJob("cleanups", env, async () => {
      const r = await runHomeCleanups(serviceClient());
      return {
        report: {
          pending: r.pending,
          done: r.done,
          failed: r.failed,
          results: r.results,
        },
        error: r.failed
          ? `${r.failed} of ${r.pending} cleanups failed`
          : undefined,
      };
    }),
  );
  // Timers nobody ended (a breastfeed, a sleep) are closed at a cap after 12 hours, with a note on the entry.
  outcomes.push(
    await runJob("timers", env, async () => {
      const { data, error } = await serviceClient().rpc(
        "timers_close_forgotten",
      );
      if (error) throw new Error(error.message);
      const r = data as {
        ok: boolean;
        message?: string;
        closed?: number;
        entries?: unknown[];
      } | null;
      if (!r?.ok) throw new Error(r?.message ?? "The database refused.");
      return { report: { closed: r.closed ?? 0, entries: r.entries ?? [] } };
    }),
  );

  const unrecorded = (await Promise.all(outcomes.map(recordRun))).filter(
    (m): m is string => m !== null,
  );
  const jobs = Object.fromEntries(outcomes.map((o) => [o.job, o]));
  const ok = allWell(outcomes);
  return NextResponse.json(
    { ok, jobs, ...(unrecorded.length ? { unrecorded } : {}) },
    { status: ok ? 200 : 500 },
  );
}
