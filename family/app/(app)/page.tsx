import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { awayParent, awayParentOn } from "@/lib/handover";
import type { DueItem, EntryRow, HomeSummary, HouseholdToday, Me, MilkData, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { addDays, fmtDate, fmtTime, fmtWhen, todayYmd, dayRange } from "@/lib/time";
import { BottleCountdown } from "@/components/BottleCountdown";
import { WORK_FROM, WORK_TO, hhmm } from "@/lib/household";
import { SimpleHome } from "@/components/SimpleHome";
import { LanaNow } from "@/components/LanaNow";
import { HandoverSince } from "@/components/HandoverSince";
import { FridgePlan } from "@/components/FridgePlan";
import { ageDays } from "@/lib/norms";
import { ThawReminder } from "@/components/MilkInsights";
import { nextFeedAt } from "@/lib/forecast";
import { Icon } from "@/components/Icon";
import { meOnce } from "@/lib/server/me";
import { HomeHeader } from "@/components/HomeHeader";
import { HomeState } from "@/components/HomeState";
import { HomeToday } from "@/components/HomeToday";
import { nextNap } from "@/lib/child-insights";
import { checkEntries } from "@/lib/entry-checks";

export const dynamic = "force-dynamic";

/**
 * Home is the child's place and fits a phone screen with few words: the child, four
 * tiles to log with, the three "right now" tiles, then the alerts of this hour (bottles
 * while the breastfeeding parent is away, the thaw, the handover). Below: the guide only
 * when it has a tip, pumping, the day so far, and icon tiles to everything else.
 */
export default async function HomePage() {
  const supabase = await createClient();
  const { data: meData } = await meOnce();
  const me = meData as Me | null;
  if (!me || !me.ok) redirect("/login");
  // Staff get the simplest screen in the product.
  // Someone without the child's log (staff who only clock in) gets their own Today screen.
  if (!can(me, "lana", "view")) redirect("/send");

  const tz = me.household.timezone;
  const today = todayYmd(tz);
  const now = new Date();
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(now));
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  // Four questions to the database, all at once: Home shows only what is needed now.
  const [{ data: hhData }, { data: sumData }, { data: dueData }, { data: milkData }] = await Promise.all([
    supabase.rpc("household_today"),
    can(me, "lana", "view") ? supabase.rpc("home_summary") : Promise.resolve({ data: null }),
    can(me, "lana", "view") ? supabase.rpc("care_due_list", { p_days_ahead: 14 }) : Promise.resolve({ data: null }),
    can(me, "lana", "view") ? supabase.rpc("milk_list") : Promise.resolve({ data: null }),
  ]);
  const milkStash = milkData as MilkData | RpcError | null;
  const milkOk = milkStash && milkStash.ok ? milkStash : null;
  const household = hhData as HouseholdToday | RpcError;
  // The away parent (breastfeeding, else the working parent) works today and it is within their hours.
  const hhm = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "numeric", hourCycle: "h23", timeZone: tz }).format(now).replace(":", ""));
  const mama = household.ok ? awayParent(household.members) : null;
  const mamaWorks = !!mama && mama.works_today;
  const from = hhmm(mama?.work_from, WORK_FROM);
  const to = hhmm(mama?.work_to, WORK_TO);
  const mamaAway = mamaWorks && hhm >= from && hhm <= to;
  const dayStart = Date.parse(dayRange(today, tz).from);
  const atLocal = (h: number) => new Date(dayStart + (Math.floor(h / 100) * 60 + (h % 100)) * 60_000).toISOString();
  const part: "morning" | "away" | "evening" | "night" = hour < 6 || hour >= 21 ? "night" : mamaWorks && hhm < from ? "morning" : mamaAway ? "away" : "evening";
  const due = ((dueData as { items?: DueItem[] } | null)?.items ?? []) as DueItem[];
  const summary = sumData as HomeSummary | RpcError | null;

  // Entries from yesterday noon until now: the night and today, for the child's strip and current state.
  let recent: EntryRow[] = [];
  let lastMilk: string | null = null;
  // The day and the week in one round trip: each question to the database is a wait.
  let weekRows: EntryRow[] | null = null;
  if (summary && summary.ok) {
    const since = new Date(new Date(today + "T12:00:00Z").getTime() - 24 * 3600 * 1000).toISOString();
    const until = new Date(Date.now() + 3600 * 1000).toISOString();
    const [{ data: listData }, { data: weekData }] = await Promise.all([
      supabase.rpc("care_entries_list", { p_subject_id: summary.subject.id, p_from: since, p_to: until }),
      me.member.simple_mode ? Promise.resolve({ data: null }) : supabase.rpc("care_entries_list", { p_subject_id: summary.subject.id, p_from: new Date(Date.now() - 7 * 86_400_000).toISOString(), p_to: until }),
    ]);
    recent = ((listData as { entries?: EntryRow[] })?.entries ?? []) as EntryRow[];
    weekRows = ((weekData as { entries?: EntryRow[] } | null)?.entries ?? null) as EntryRow[] | null;
    const lastBottle = recent.find((e) => e.type_id === "lana.feed" && e.payload.method === "Bottle" && typeof e.payload.milk === "string");
    lastMilk = (lastBottle?.payload.milk as string | undefined) ?? null;
  }

  if (me.member.simple_mode && summary && summary.ok) {
    return <SimpleHome summary={summary} recent={recent} milk={milkOk} />;
  }

  const lastFeedAt = summary && summary.ok ? (summary.last["lana.feed"]?.ended_at ?? summary.last["lana.feed"]?.occurred_at ?? null) : null;
  // A week of entries for the forecast; the "recent" list only covers the last day.
  const week: EntryRow[] = weekRows ?? recent;
  const awayAt = (at: number) => {
    if (!mama || !mama.works_today) return false;
    const d = new Date(at);
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(d);
    const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.find((p) => p.type === "weekday")?.value ?? "");
    const hm = Number(parts.find((p) => p.type === "hour")?.value ?? 0) * 100 + Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    return mama.work_days.includes(wd) && hm >= from && hm <= to;
  };
  const sitter = me.role.id === "sitter";
  const bottleGapMin = milkOk?.bottle_interval_min ?? 120;
  // While Mama is away the bottle interval is the gap, shortened after a small bottle.
  const nextBottle = mamaAway ? nextFeedAt(week, { gapMin: bottleGapMin, awayCapMin: bottleGapMin, away: awayAt }) : null;
  // Tomorrow has its own away parent: two parents who work on different days each get their day.
  const tomorrowWd = new Date(Date.parse(dayRange(addDays(today, 1), tz).from) + 12 * 3_600_000).getUTCDay();
  const tomorrowsParent = household.ok ? awayParentOn(household.members, tomorrowWd) : null;
  const awayTomorrow = !!tomorrowsParent && tomorrowsParent.work_days.includes(tomorrowWd);
  const tFrom = hhmm(tomorrowsParent?.work_from, WORK_FROM);
  const tTo = hhmm(tomorrowsParent?.work_to, WORK_TO);
  const thawOpts = { awayTomorrow, awayMinutes: (Math.floor(tTo / 100) * 60 + (tTo % 100)) - (Math.floor(tFrom / 100) * 60 + (tFrom % 100)), intervalMin: bottleGapMin, hour };
  const lastBottleMl = Number(recent.find((e) => e.type_id === "lana.feed" && e.payload.method === "Bottle")?.payload.amount_ml) || 120;

  // The alerts of this hour, in order. Each is one line or a small card; they are never folded.
  const alerts: Record<string, React.ReactNode> =
    summary && summary.ok
      ? {
          countdown: milkOk ? <BottleCountdown key="c" milk={milkOk} lastFeedAt={lastFeedAt} mamaAway={mamaAway} timezone={tz} nextAtIso={nextBottle ? new Date(nextBottle.at).toISOString() : null} /> : null,
          thaw: milkOk ? <ThawReminder key="th" milk={milkOk} entries={week} timezone={tz} opts={thawOpts} /> : null,
          plan: milkOk && mamaAway ? <FridgePlan key="fp" milk={milkOk} lastFeedAt={lastFeedAt} backAtIso={atLocal(to)} bottleMl={lastBottleMl} timezone={tz} name={mama?.name ?? "Mama"} /> : null,
          handover:
            mamaWorks && (part === "away" || part === "evening") && hhm >= from ? (
              <HandoverSince key="h" entries={recent} fromIso={atLocal(from)} toIso={part === "away" ? now.toISOString() : atLocal(to)} label={part === "away" ? `Since ${mama?.name ?? "Mama"} left at ${fmtTime(atLocal(from), tz)}` : `While ${mama?.name ?? "Mama"} was at work`} />
            ) : null,
        }
      : {};
  const order =
    part === "away" ? ["countdown", "plan", "handover"]
    : part === "evening" ? ["thaw", "handover"]
    : part === "night" ? ["thaw", "countdown"]
    : ["countdown"];
  const vaccine = summary && summary.ok ? due.find((d) => d.kind === "vaccine" && d.subject_id === summary.subject.id) : undefined;

  // ---- the Now slot (DESIGN.md, rule 3): candidates in order, safety first; only the first
  // that renders anything shows (.now-queue). Whatever else applies waits on the child's page.
  const feedDue = summary && summary.ok ? summary.last["lana.feed"]?.next_due ?? null : null;
  const feedIsDue = !!feedDue && Date.parse(feedDue) <= now.getTime() && !(summary && summary.ok && summary.ongoing.some((e) => e.type_id === "lana.feed"));
  const hourOf = (iso: string) => {
    const p = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date(iso));
    return Number(p.find((x) => x.type === "hour")?.value ?? 0) + Number(p.find((x) => x.type === "minute")?.value ?? 0) / 60;
  };
  const nap = summary && summary.ok && summary.subject.birth_date ? nextNap(week, ageDays(summary.subject.birth_date, today), now.getTime(), hourOf) : null;
  const napSoon = !!nap && !nap.asleepSince && nap.at != null && nap.awakeMin <= 12 * 60 && nap.at - now.getTime() <= 20 * 60_000;
  const checks = summary && summary.ok && can(me, "lana", "edit") ? checkEntries(week).length : 0;
  const known = [vaccine?.overdue, mamaAway && !!milkOk, feedIsDue, napSoon, checks > 0, vaccine && !vaccine.overdue, !!milkOk && milkOk.fridge_ml < lastBottleMl].filter(Boolean).length;

  return summary && summary.ok ? (
    <div className="screen-fill">
      <HomeHeader summary={summary} me={me} today={today} />
      <HomeState summary={summary} timezone={tz} />
      <div className="now-queue">
        <div>
          {vaccine?.overdue && (
            <Link href="/baby/vaccines" className="notice notice-danger flex items-center gap-2 no-underline">
              <Icon name="syringe" size={20} /> <span className="flex-1 font-semibold">A vaccine is overdue</span> <Icon name="forward" size={18} />
            </Link>
          )}
        </div>
        <div>{mamaAway ? alerts.countdown : null}</div>
        <div>
          {feedIsDue && (
            <p className="notice notice-warn">
              <b>Feed due now</b>
              {lastFeedAt ? ` · last ${fmtWhen(lastFeedAt, tz, now)}` : ""}
            </p>
          )}
        </div>
        <div>
          {napSoon && nap?.at != null && (
            <p className="notice notice-warn">
              <b>
                {nap.isBedtime ? "Bedtime" : "Nap"} {nap.at <= now.getTime() ? "was due" : "due"} around {fmtTime(new Date(nap.at).toISOString(), tz)}
              </b>{" "}
              · start winding down
            </p>
          )}
        </div>
        <div>{order.includes("plan") ? alerts.plan : null}</div>
        <div>{order.includes("handover") ? alerts.handover : null}</div>
        <div>{order.includes("thaw") ? alerts.thaw : null}</div>
        <div>
          {checks > 0 && (
            <Link href="/baby" className="notice notice-warn flex items-center gap-2 no-underline">
              <span className="flex-1 font-semibold">
                {checks} {checks === 1 ? "entry" : "entries"} to check
              </span>
              <Icon name="forward" size={18} />
            </Link>
          )}
        </div>
        <div>
          {vaccine && !vaccine.overdue && (
            <Link href="/baby/vaccines" className="notice flex items-center gap-2 no-underline tint-meds">
              <Icon name="syringe" size={20} /> <span className="flex-1 font-semibold">A vaccine is due</span> <Icon name="forward" size={18} />
            </Link>
          )}
        </div>
        <div>
          {milkOk && milkOk.fridge_ml < lastBottleMl && (
            <Link href="/baby/milk" className="notice flex items-center gap-2 no-underline tint-milk">
              <Icon name="droplet" size={20} /> <span className="flex-1 font-semibold">Fridge is low: {milkOk.fridge_ml} ml</span> <Icon name="forward" size={18} />
            </Link>
          )}
        </div>
        <div>
          {sitter && (
            <Link href="/baby?tab=handover" className="notice flex items-center gap-2 no-underline">
              <span className="flex-1 font-semibold">The handover</span> <Icon name="forward" size={18} />
            </Link>
          )}
        </div>
      </div>
      {known > 1 && (
        <Link href="/baby" className="muted -mt-3 flex min-h-[44px] items-center self-end px-1 text-sm font-semibold">
          {known - 1} more ›
        </Link>
      )}
      <div className="grow-space" />
      <HomeToday entries={recent} day={today} timezone={tz} nowIso={now.toISOString()} />
      <LanaNow subject={summary.subject} types={summary.types} ongoing={summary.ongoing} recent={recent} timezone={tz} lastMilk={lastMilk} />
    </div>
  ) : (
    <div className="flex flex-col gap-4">
      <header className="page-header page-header-large">
        <p className="muted">{fmtDate(now.toISOString(), tz, { weekday: "long", day: "numeric", month: "long" })}</p>
        <h1 className="page-title">
          {greeting}, {me.member.display_name}
        </h1>
      </header>
      {summary && !summary.ok && (
        <div className="card">
          <p>{summary.message}</p>
        </div>
      )}
    </div>
  );
}
