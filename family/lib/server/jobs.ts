import type { JobOutcome } from "@/lib/jobs";
import { serviceClient } from "./member";

/**
 * The record of each job's last run (public.job_runs, one row per job, service
 * role only; audit viewers read it through job_runs_list). Writing it never fails
 * the run: a record that cannot be kept is reported in the response instead.
 */
export async function recordRun(o: JobOutcome): Promise<string | null> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return "SUPABASE_SERVICE_ROLE_KEY is not set: the run was not recorded";
  try {
    const now = new Date().toISOString();
    const row: Record<string, unknown> = {
      job: o.job,
      last_at: now,
      last_status: o.status,
      last_ms: o.ms,
      last_error: o.status === "failed" ? o.error : o.status === "not_configured" ? `not configured: ${(o.missing ?? []).join(", ")}` : null,
      last_report: o.report ?? null,
    };
    if (o.status === "ok") row.last_ok_at = now;
    const { error } = await serviceClient().from("job_runs").upsert(row, { onConflict: "job" });
    return error ? `${o.job}: ${error.message}` : null;
  } catch (e) {
    return `${o.job}: ${e instanceof Error ? e.message : String(e)}`;
  }
}
