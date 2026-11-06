import type { SupabaseClient } from "@supabase/supabase-js";
import type { Me, RpcError } from "@/lib/types";
import { dailyTotal, decideAllowance, type AllowanceCounts } from "./allowance-rule";

/**
 * Asked before every model call: may the helper spend one more call for this
 * member in this home today? assistant_reserve() checks the home's and the
 * member's limits and the deployment-wide cap (ASSISTANT_DAILY_TOTAL, passed in)
 * and books the call in the same step, under one lock, so requests sent together
 * cannot all take the last free slot. ASSISTANT_OTHER_HOMES=off is checked here
 * first (no booking needed to say no). A database that cannot answer (the
 * migration not there yet) lets the call through: the limit is a cap on
 * spending, and a missing counter must not take the helper down.
 */
export async function checkAllowance(supabase: SupabaseClient, me: Me): Promise<{ ok: true } | RpcError> {
  const switches = { otherHomes: process.env.ASSISTANT_OTHER_HOMES, dailyTotal: process.env.ASSISTANT_DAILY_TOTAL };
  const none: AllowanceCounts = { home_calls: 0, member_calls: 0, home_limit: null, member_limit: null, total_calls: 0, platform: !!me.platform };
  const before = decideAllowance(none, { otherHomes: switches.otherHomes });
  if (!before.ok) return { ok: false, error: before.error, message: before.message };

  type Reply = ({ ok: true; reserved: boolean } & AllowanceCounts) | RpcError;
  let r: Reply | null = null;
  try {
    const { data, error } = await supabase.rpc("assistant_reserve", { p_total: dailyTotal(switches.dailyTotal) });
    if (!error) r = data as Reply | null;
  } catch {
    /* fall through: no answer */
  }
  if (!r || !r.ok || r.reserved) return { ok: true };
  // Not booked: the counts as they stood say which limit was reached.
  const decision = decideAllowance(r, switches);
  return decision.ok
    ? { ok: false, error: "limit", message: "The helper is resting until midnight. Everything else in the app works as usual." }
    : { ok: false, error: decision.error, message: decision.message };
}

