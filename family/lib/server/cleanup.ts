import type { SupabaseClient } from "@supabase/supabase-js";
import { removeFolder } from "./storage";

/**
 * The file cleanup a deleted home leaves behind. household_delete takes the rows and
 * queues a row in home_cleanups; the deletion route tries the removal at once, and
 * the daily cron retries whatever is still pending, so a failed removal is never
 * forgotten and the status reported is the real one. Service role only.
 */

const BUCKETS = ["photos", "backups"] as const;
const MAX_ATTEMPTS = 30;

export interface CleanupResult {
  household_id: string;
  done: boolean;
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
    return { household_id: householdId, done: false, removed, error };
  }
  await service.from("home_cleanups").update({ attempts, last_error: null, done_at: new Date().toISOString() }).eq("household_id", householdId);
  return { household_id: householdId, done: true, removed };
}

/** Every cleanup still pending, oldest first; one that keeps failing stops after MAX_ATTEMPTS and stays listed. */
export async function runHomeCleanups(service: SupabaseClient): Promise<{ pending: number; done: number; failed: number; results: CleanupResult[] }> {
  const { data, error } = await service.from("home_cleanups").select("household_id, attempts").is("done_at", null).order("requested_at");
  if (error) throw new Error(error.message);
  const rows = ((data as { household_id: string; attempts: number }[] | null) ?? []).filter((r) => r.attempts < MAX_ATTEMPTS);
  const results: CleanupResult[] = [];
  for (const r of rows) results.push(await cleanupHome(service, r.household_id));
  return { pending: rows.length, done: results.filter((r) => r.done).length, failed: results.filter((r) => !r.done).length, results };
}
