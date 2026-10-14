"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CoachPlan } from "@/lib/types";
import { can } from "@/lib/types";
import { useMe } from "@/lib/me-context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Icon } from "@/components/Icon";

/** The active coach plan: today's step, a "Done today" tap, and the way back to the coach. */
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
  const done = plan.checkins.filter((c) => c.done).length;
  return (
    <section className="card flex flex-col gap-2 bg-[var(--info-soft)]" aria-labelledby="plan-h">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="plan-h" className="font-semibold">
          Coach plan · day {Math.max(1, plan.day)} of {plan.days}
        </h2>
        <span className="muted text-sm">
          {done}/{plan.days} done
        </span>
      </div>
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
          <Link href={`/ask?from=plan&say=${encodeURIComponent(`How is the plan "${plan.goal}" going? Day ${Math.max(1, plan.day)}.`)}`} className="btn" style={{ minHeight: 44 }}>
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
    </section>
  );
}
