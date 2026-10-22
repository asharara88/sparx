import type { SupabaseClient } from "@supabase/supabase-js";
import { removeFolder } from "./storage";

/**
 * The file cleanup a deleted home leaves behind. household_delete takes the rows and
 * queues a row in home_cleanups; the deletion route tries the removal at once, and
 * the daily cron retries whatever is still pending, every day until it is done, so
 * a failed removal is never forgotten and the status reported is the real one. A
 * row that keeps failing stays in the cron's report with its attempts and last
 * error, which is where someone sees it. Service role only.
 */

const BUCKETS = ["photos", "backups"] as const;

export interface CleanupResult {
  household_id: string;
  done: boolean;
  /** how many times this cleanup has been tried, this one included */
  attempts: number;
  removed: Partial<Record<(typeof BUCKETS)[number], number>>;
  error?: string;
}

/** Remove one home's folders and record the outcome on its cleanup row. */
export async function cleanupHome(service: SupabaseClient, householdId: string): Promise<CleanupResult> {
  const removed: CleanupResult["removed"] = {};
  const { data: row } = await service.from("home_cleanups").select("attempts").eq("household_id", householdId).maybeSingle();
  const attempts = ((row as { attempts?: number } | null)?.attempts ?? 0) + 1;
  try {
    for (const bucket of BUCKETS) removed[bucket] = await removeFolder(service, bucket, `home-${householdId}`);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await service.from("home_cleanups").update({ attempts, last_error: error }).eq("household_id", householdId);
    return { household_id: householdId, done: false, attempts, removed, error };
  }
  await service.from("home_cleanups").update({ attempts, last_error: null, done_at: new Date().toISOString() }).eq("household_id", householdId);
  return { household_id: householdId, done: true, attempts, removed };
}

/** Every cleanup still pending, oldest first. Each is tried again; the report carries what failed and why. */
export async function runHomeCleanups(service: SupabaseClient): Promise<{ pending: number; done: number; failed: number; results: (CleanupResult & { attempts: number })[] }> {
  const { data, error } = await service.from("home_cleanups").select("household_id").is("done_at", null).order("requested_at");
  if (error) throw new Error(error.message);
  const rows = (data as { household_id: string }[] | null) ?? [];
  const results: (CleanupResult & { attempts: number })[] = [];
  for (const r of rows) results.push(await cleanupHome(service, r.household_id));
  return { pending: rows.length, done: results.filter((r) => r.done).length, failed: results.filter((r) => !r.done).length, results };
}
