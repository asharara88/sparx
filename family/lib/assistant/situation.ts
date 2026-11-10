import { ageInDays, SOLIDS_FROM_DAYS } from "@/lib/stage";
import type { ToolContext } from "./tools";
import { local } from "./tools";
import { ageOutlook } from "@/lib/child-insights";
import { can } from "@/lib/types";
import { addDays, todayYmd } from "@/lib/time";
import { pronouns } from "@/lib/names";
import { hhmmIn } from "@/lib/night";
import { formatHome, formatMilk, formatSituation, type HomeNow } from "./situation-format";

/**
 * The situation snapshot: a few lines the model gets before it says anything,
 * so "is she asleep", "how long has she been up" or "when is the next feed"
 * need no tool call, and every coaching answer starts from where the child
 * actually is: right now, last night, and the usual day lately. Built from the
 * same RPCs the screens use, under the member's own permissions; a failed read
 * leaves its line out rather than failing the answer.
 */

type DayRow = { day: string; breast_count?: number; bottle_count?: number; bottle_ml?: number; sleep_min?: number; night_sleep_min?: number; night_wakes?: number; night_feeds?: number; longest_stretch_min?: number };
type Summary = {
  ok?: boolean;
  ongoing?: { type_id: string; occurred_at: string }[];
  last?: Record<string, { occurred_at: string; ended_at?: string | null; payload?: Record<string, unknown>; next_due?: string | null }>;
  today_counts?: Record<string, number>;
  custody?: { name?: string | null } | null;
};

function weekAverages(rows: DayRow[], today: string): { days: number; feeds: number; bottleMl: number; sleepMin: number; nightMin: number } | null {
  const full = rows.filter((r) => r.day < today && ((r.breast_count ?? 0) + (r.bottle_count ?? 0) > 0 || (r.sleep_min ?? 0) > 0));
  if (full.length < 3) return null;
  const avg = (f: (r: DayRow) => number) => Math.round(full.reduce((n, r) => n + f(r), 0) / full.length);
  return { days: full.length, feeds: avg((r) => (r.breast_count ?? 0) + (r.bottle_count ?? 0)), bottleMl: avg((r) => r.bottle_ml ?? 0), sleepMin: avg((r) => r.sleep_min ?? 0), nightMin: avg((r) => r.night_sleep_min ?? 0) };
}

/** One snapshot per child the member may see, then who is in the house. Empty when there is none. */
export async function loadSituation(ctx: ToolContext): Promise<string> {
  const kids = ctx.subjects.filter((s) => s.kind === "child" && can(ctx.me, s.module_id, "view"));
  const today = todayYmd(ctx.tz, ctx.now);
  const parts: string[] = [];
  const homeP = can(ctx.me, "members", "view") ? ctx.supabase.rpc("household_today") : null;
  const milkP = kids.length ? ctx.supabase.rpc("milk_list") : null;
  for (const s of kids) {
    const [{ data: sum }, { data: planData }, { data: histData }, { data: statsData }] = await Promise.all([
      ctx.supabase.rpc("home_summary", { p_subject_id: s.id }),
      ctx.supabase.rpc("coach_plan_active", { p_subject_id: s.id }),
      ctx.supabase.rpc("coach_plan_history", { p_subject_id: s.id, p_limit: 1 }),
      ctx.supabase.rpc("care_daily_stats", { p_subject_id: s.id, p_from: addDays(today, -7), p_to: today }),
    ]);
    const r = sum as Summary | null;
    if (!r?.ok) continue;
    const feed = r.last?.[`${s.module_id}.feed`];
    const lastSleep = r.last?.[`${s.module_id}.sleep`];
    const diaper = r.last?.[`${s.module_id}.diaper`];
    const sleep = (r.ongoing ?? []).find((o) => o.type_id === `${s.module_id}.sleep`);
    const p = (planData as { ok?: boolean; plan?: { goal: string; day: number; days: number; today_step?: string | null; done_today?: boolean } | null } | null)?.plan ?? null;
    const last = ((histData as { ok?: boolean; plans?: { goal: string; status: string; done: number; days?: number; to?: string; notes?: string[] }[] } | null)?.plans ?? [])[0];
    const lastLine = !p && last && last.status !== "active" ? `Last plan "${last.goal}" ended ${last.to ?? ""} (${last.status}, ${last.done} days ticked${last.notes?.length ? `; notes: ${last.notes.slice(0, 2).join("; ")}` : ""}).` : null;
    const ageDays = ageInDays(s.birth_date, ctx.now.getTime(), ctx.tz);
    const o = ageDays != null ? ageOutlook(ageDays) : null;
    const phase = o ? `Phase: ${o.now.length ? o.now.map((w) => w.split(":")[0]).join("; ") : "a quiet stretch"}${o.next[0] ? `; next: ${o.next[0].what.split(":")[0].toLowerCase()} in about ${o.next[0].inAboutDays} days` : ""}. Usual awake window ${o.awakeWindowMin[0]} to ${o.awakeWindowMin[1]} min.` : null;
    const stats = statsData as { ok?: boolean; days?: DayRow[]; night_to?: string } | null;
    const rows = (stats?.days ?? []) as DayRow[];
    // A day's row holds the night that starts that evening. Yesterday's is last night once the
    // night is over; before then (03:00) it is the night still going, so the last full night
    // is the row before.
    const nightTo = /^\d{2}:\d{2}/.test(stats?.night_to ?? "") ? stats!.night_to!.slice(0, 5) : "07:00";
    const nightOver = hhmmIn(ctx.now, ctx.tz) >= nightTo;
    const night = rows.find((d) => d.day === addDays(today, nightOver ? -1 : -2));
    const lastNight = night && ((night.night_sleep_min ?? 0) > 0 || (night.night_wakes ?? 0) > 0 || (night.night_feeds ?? 0) > 0) ? { sleepMin: night.night_sleep_min ?? 0, wakes: night.night_wakes ?? 0, feeds: night.night_feeds ?? 0, longestMin: night.longest_stretch_min ?? 0 } : null;
    parts.push(
      formatSituation({
        name: s.name,
        them: pronouns(s.sex).them,
        nowLocal: local(ctx.now.toISOString(), ctx.tz) ?? "",
        ageDays,
        phase,
        asleepSince: sleep ? local(sleep.occurred_at, ctx.tz) : null,
        awakeSince: !sleep && lastSleep?.ended_at ? local(lastSleep.ended_at, ctx.tz) : null,
        lastFeedAt: feed ? local(feed.occurred_at, ctx.tz) : null,
        lastFeedMl: feed?.payload?.amount_ml ? Number(feed.payload.amount_ml) : null,
        lastFeedKind: feed?.payload?.kind ? String(feed.payload.kind) : feed?.payload?.side ? `breast ${feed.payload.side}` : null,
        nextFeedDue: feed?.next_due ? local(feed.next_due, ctx.tz) : null,
        lastDiaperAt: diaper ? local(diaper.occurred_at, ctx.tz) : null,
        lastDiaperKind: diaper?.payload?.kind ? String(diaper.payload.kind) : null,
        feedsToday: r.today_counts?.[`${s.module_id}.feed`] ?? 0,
        diapersToday: r.today_counts?.[`${s.module_id}.diaper`] ?? 0,
        mealsToday: ageDays != null && ageDays >= SOLIDS_FROM_DAYS ? (r.today_counts?.[`${s.module_id}.meal`] ?? 0) : (r.today_counts?.[`${s.module_id}.meal`] ?? null),
        whoHas: r.custody?.name ?? null,
        plan: p ? { goal: p.goal, day: p.day, days: p.days, todayStep: p.today_step ?? null, doneToday: !!p.done_today } : null,
        lastNight,
        week: weekAverages(rows, today),
      }) + (lastLine ? `\n${lastLine}` : ""),
    );
  }
  if (milkP) {
    const { data } = await milkP;
    const m = data as { ok?: boolean; fridge_ml: number; fridge_count: number; freezer_ml: number; freezer_count: number } | null;
    const line = m?.ok ? formatMilk(m) : null;
    if (line) parts.push(line);
  }
  if (homeP) {
    const { data } = await homeP;
    const r = data as { ok?: boolean; members?: { name: string; presence?: { in_house?: boolean | null; label?: string | null; ends_on?: string | null } | null; works_today?: boolean }[] } | null;
    const members: HomeNow[] = (r?.ok ? (r.members ?? []) : []).map((m) => ({ name: m.name, inHouse: m.presence?.in_house ?? null, label: m.presence ? `${m.presence.label ?? ""}${m.presence.ends_on ? ` until ${m.presence.ends_on}` : ""}`.trim() || null : null, worksToday: !!m.works_today }));
    const line = formatHome(members);
    if (line) parts.push(line);
  }
  return parts.join("\n\n");
}
