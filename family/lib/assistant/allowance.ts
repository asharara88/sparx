import type { SupabaseClient } from "@supabase/supabase-js";
import type { Me, RpcError } from "@/lib/types";
import { decideAllowance, type AllowanceCounts } from "./allowance-rule";

/**
 * Asked before every model call: may the helper spend one more call for this
 * member in this home today? The counts come from the audit log (every model
 * call writes one row there), the limits from the home's settings, the two
 * deployment switches from the server's environment. A database that cannot
 * answer (the migration not there yet) lets the call through: the limit is a
 * cap on spending, and a missing counter must not take the helper down.
 */
export async function checkAllowance(supabase: SupabaseClient, me: Me): Promise<{ ok: true } | RpcError> {
  let counts: AllowanceCounts | null = null;
  try {
    const { data, error } = await supabase.rpc("assistant_allowance");
    const r = data as ({ ok: true } & AllowanceCounts) | RpcError | null;
    if (!error && r && r.ok) counts = r;
  } catch {
    /* fall through: no counts */
  }
  const decision = decideAllowance(counts ?? { home_calls: 0, member_calls: 0, home_limit: null, member_limit: null, total_calls: 0, platform: !!me.platform }, {
    otherHomes: process.env.ASSISTANT_OTHER_HOMES,
    dailyTotal: process.env.ASSISTANT_DAILY_TOTAL,
  });
  return decision.ok ? { ok: true } : { ok: false, error: decision.error, message: decision.message };
}
