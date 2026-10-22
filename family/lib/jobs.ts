/**
 * The daily cron's jobs, run apart. Pushes, the backup, the file cleanups and the
 * timers left on each
 * have their own configuration and their own failure: one missing key or one
 * thrown error stops that job, never the others. No imports here: the node test
 * runner loads this file.
 */
export type JobName = "pushes" | "backup" | "cleanups" | "timers";
export const JOBS: readonly JobName[] = [
  "pushes",
  "backup",
  "cleanups",
  "timers",
];

/** What each job needs set on the server. */
const NEEDS: Record<JobName, readonly string[]> = {
  pushes: [
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_JWT_SECRET",
    "VAPID_PUBLIC_KEY",
    "VAPID_PRIVATE_KEY",
  ],
  backup: ["SUPABASE_SERVICE_ROLE_KEY"],
  cleanups: ["SUPABASE_SERVICE_ROLE_KEY"],
  timers: ["SUPABASE_SERVICE_ROLE_KEY"],
};

export function missingFor(
  job: JobName,
  env: Record<string, string | undefined>,
): string[] {
  return NEEDS[job].filter((k) => !env[k]);
}

export interface JobOutcome {
  job: JobName;
  status: "ok" | "failed" | "not_configured";
  /** the keys a not_configured job is missing */
  missing?: string[];
  /** the failure, for a failed job */
  error?: string;
  /** a short summary of what an ok job did */
  report?: Record<string, unknown>;
  ms: number;
}

/** What a job hands back: its report, and an error when part of the work failed without throwing. */
export interface JobResult {
  report: Record<string, unknown>;
  error?: string;
}

/**
 * Run one job: skipped when its configuration is missing, failed when it throws or
 * comes back with an error of its own (a push that failed for one member, a cleanup
 * still pending), ok otherwise. A failed job keeps its report. Never throws.
 */
export async function runJob(
  job: JobName,
  env: Record<string, string | undefined>,
  fn: () => Promise<JobResult>,
): Promise<JobOutcome> {
  const missing = missingFor(job, env);
  if (missing.length) return { job, status: "not_configured", missing, ms: 0 };
  const t0 = Date.now();
  try {
    const { report, error } = await fn();
    if (error)
      return { job, status: "failed", error, report, ms: Date.now() - t0 };
    return { job, status: "ok", report, ms: Date.now() - t0 };
  } catch (e) {
    return {
      job,
      status: "failed",
      error: e instanceof Error ? e.message : String(e),
      ms: Date.now() - t0,
    };
  }
}

/** The run as a whole went well when no job failed; a job that is not configured is reported, not counted as a failure. */
export function allWell(outcomes: JobOutcome[]): boolean {
  return outcomes.every((o) => o.status !== "failed");
}
