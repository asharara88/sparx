"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CoachPlan } from "@/lib/types";
import { can } from "@/lib/types";
import { useMe } from "@/lib/me-context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Icon } from "@/components/Icon";
import { Fold } from "@/components/Fold";

/**
 * The active coach plan (the helper's plan card, started with one tap) as a row of the child's
 * Today list: "Coach plan" with "day 3 of 7" on its bar ("day 3 of 7 · done" once marked);
 * opened, today's step, a "Done today" tap, and the way back to the coach. Closed like the
 * rows around it: the screen budget counts what shows before a row is opened, and the Today
 * tab is at its budget (an open row added 48 words and 0.4 of a screen).
 *
 * Mido, 27 November: a plan started from the helper was nowhere to be found. It sat in Week's
 * closed "Coming up" row, and the helper said "Today's step is on Home", which it had not been
 * since October. It is a row, not a card of its own: the Today tab is at its block budget.
 */
export function PlanCard({ plan }: { plan: CoachPlan | null }) {
  const me = useMe();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (!plan || plan.over) return null;
  const canAct = can(me, "lana", "add");
  async function call(fn: string, args: Record<string, unknown>) {
    setBusy(true);
    setMsg(null);
    const { data, error } = await supabaseBrowser().rpc(fn, args);
    const res = data as { ok: boolean; message?: string } | null;
    setBusy(false);
    if (error || !res?.ok) return setMsg(res?.message ?? error?.message ?? "Could not save.");
    router.refresh();
  }
  const day = `day ${Math.max(1, plan.day)} of ${plan.days}`;
  return (
    <Fold flat title="Coach plan" icon="star" tint="guide" hint={plan.done_today ? `${day} · done` : day}>
      <p className="muted text-sm">{plan.goal}</p>
      <p className="text-lg font-semibold">{plan.today_step ?? "Keep going."}</p>
      <div className="flex flex-wrap gap-2">
        {plan.done_today ? (
          <span className="pill pill-ok">
            <Icon name="check" size={16} /> Done today
          </span>
        ) : (
          canAct && (
            <button type="button" className="btn btn-primary" style={{ minHeight: 44 }} disabled={busy} onClick={() => void call("coach_plan_checkin", { p_plan_id: plan.id, p_day: null, p_done: true, p_note: null })}>
              Done today
            </button>
          )
        )}
        {can(me, "assistant", "view") && (
          <Link prefetch={false} href={`/ask?from=plan&say=${encodeURIComponent(`How is the plan "${plan.goal}" going? Day ${Math.max(1, plan.day)}.`)}`} className="btn" style={{ minHeight: 44 }}>
            Ask the coach
          </Link>
        )}
        {canAct && (
          <button type="button" className="btn btn-ghost" style={{ minHeight: 44 }} disabled={busy} onClick={() => window.confirm("Stop this plan?") && void call("coach_plan_stop", { p_plan_id: plan.id })}>
            Stop
          </button>
        )}
      </div>
      {msg && (
        <p className="text-sm text-[var(--danger)]" role="alert">
          {msg}
        </p>
      )}
    </Fold>
  );
}
