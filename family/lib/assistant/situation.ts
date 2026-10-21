import type { ToolContext } from "./tools";
import { local } from "./tools";
import { ageOutlook } from "@/lib/child-insights";
import { can } from "@/lib/types";
import { formatSituation } from "./situation-format";

/**
 * The situation snapshot: a few lines the model gets before it says anything,
 * so "is she asleep" or "when is the next feed" need no tool call and every
 * coaching answer starts from where she actually is right now. Built from the
 * same RPCs the screens use, under the member's own permissions.
 */

/** One snapshot per child the member may see. Empty when there is none. */
export async function loadSituation(ctx: ToolContext): Promise<string> {
  const kids = ctx.subjects.filter((s) => s.kind === "child" && can(ctx.me, s.module_id, "view"));
  const parts: string[] = [];
  for (const s of kids) {
    const [{ data: sum }, { data: planData }, { data: histData }] = await Promise.all([ctx.supabase.rpc("home_summary", { p_subject_id: s.id }), ctx.supabase.rpc("coach_plan_active", { p_subject_id: s.id }), ctx.supabase.rpc("coach_plan_history", { p_subject_id: s.id, p_limit: 1 })]);
    const r = sum as { ok?: boolean; ongoing?: { type_id: string; occurred_at: string }[]; last?: Record<string, { occurred_at: string; payload?: Record<string, unknown>; next_due?: string | null }>; today_counts?: Record<string, number>; custody?: { name?: string | null } | null } | null;
    if (!r?.ok) continue;
    const feed = r.last?.[`${s.module_id}.feed`];
    const sleep = (r.ongoing ?? []).find((o) => o.type_id === `${s.module_id}.sleep`);
    const p = (planData as { ok?: boolean; plan?: { goal: string; day: number; days: number; today_step?: string | null; done_today?: boolean } | null } | null)?.plan ?? null;
    const last = ((histData as { ok?: boolean; plans?: { goal: string; status: string; done: number; days?: number; to?: string; notes?: string[] }[] } | null)?.plans ?? [])[0];
    const lastLine = !p && last && last.status !== "active" ? `Last plan "${last.goal}" ended ${last.to ?? ""} (${last.status}, ${last.done} days ticked${last.notes?.length ? `; notes: ${last.notes.slice(0, 2).join("; ")}` : ""}).` : null;
    const ageDays = s.birth_date ? Math.floor((ctx.now.getTime() - Date.parse(s.birth_date)) / 86_400_000) : null;
    const o = ageDays != null ? ageOutlook(ageDays) : null;
    const phase = o ? `Phase: ${o.now.length ? o.now.map((w) => w.split(":")[0]).join("; ") : "a quiet stretch"}${o.next[0] ? `; next: ${o.next[0].what.split(":")[0].toLowerCase()} in about ${o.next[0].inAboutDays} days` : ""}. Usual awake window ${o.awakeWindowMin[0]} to ${o.awakeWindowMin[1]} min.` : null;
    parts.push(
      formatSituation({
        name: s.name,
        nowLocal: local(ctx.now.toISOString(), ctx.tz) ?? "",
        ageDays,
        phase,
        asleepSince: sleep ? local(sleep.occurred_at, ctx.tz) : null,
        lastFeedAt: feed ? local(feed.occurred_at, ctx.tz) : null,
        lastFeedMl: feed?.payload?.amount_ml ? Number(feed.payload.amount_ml) : null,
        lastFeedKind: feed?.payload?.kind ? String(feed.payload.kind) : feed?.payload?.side ? `breast ${feed.payload.side}` : null,
        nextFeedDue: feed?.next_due ? local(feed.next_due, ctx.tz) : null,
        feedsToday: r.today_counts?.[`${s.module_id}.feed`] ?? 0,
        diapersToday: r.today_counts?.[`${s.module_id}.diaper`] ?? 0,
        whoHas: r.custody?.name ?? null,
        plan: p ? { goal: p.goal, day: p.day, days: p.days, todayStep: p.today_step ?? null, doneToday: !!p.done_today } : null,
      }) + (lastLine ? `\n${lastLine}` : ""),
    );
  }
  return parts.join("\n\n");
}
