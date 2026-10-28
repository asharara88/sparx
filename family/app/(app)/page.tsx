import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { awayParent, awayParentOn } from "@/lib/handover";
import type { AttendanceData, CalendarData, DueItem, EntryRow, HomeSummary, HouseholdToday, Me, MilkData, NotesData, RpcError, Suggestion } from "@/lib/types";
import { can } from "@/lib/types";
import { possessive } from "@/lib/names";
import { addDays, fmtDate, fmtTime, todayYmd, dayRange } from "@/lib/time";
import { SuggestionCards } from "@/components/SuggestionCards";
import { AttendanceButton } from "@/components/AttendanceButton";
import { BottleCountdown } from "@/components/BottleCountdown";
import { WORK_FROM, WORK_TO, hhmm } from "@/lib/household";
import { SimpleHome } from "@/components/SimpleHome";
import { LanaHero } from "@/components/LanaHero";
import { LanaNow } from "@/components/LanaNow";
import { RightNow } from "@/components/RightNow";
import { LanaGuide } from "@/components/LanaGuide";
import { PumpTarget } from "@/components/PumpTarget";
import { HandoverSince } from "@/components/HandoverSince";
import { FridgePlan } from "@/components/FridgePlan";
import { DayStrip } from "@/components/DayStrip";
import { SayIt } from "@/components/SayIt";
import { EntryChecks } from "@/components/EntryChecks";
import { NextNap } from "@/components/NextNap";
import { Backfill } from "@/components/Backfill";
import { ageDays } from "@/lib/norms";
import { ThawReminder } from "@/components/MilkInsights";
import { nextFeedAt } from "@/lib/forecast";
import { milkForecast } from "@/lib/milk-insights";
import { Icon } from "@/components/Icon";
import { Fold } from "@/components/Fold";
import { meOnce } from "@/lib/server/me";

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

  const [{ data: hhData }, { data: sumData }, { data: calData }, { data: dueData }, { data: sugData }, { data: notesData }, { data: attData }, { data: milkData }] = await Promise.all([
    supabase.rpc("household_today"),
    can(me, "lana", "view") ? supabase.rpc("home_summary") : Promise.resolve({ data: null }),
    can(me, "calendar", "view") ? supabase.rpc("calendar_list", { p_from: today, p_to: addDays(today, 1) }) : Promise.resolve({ data: null }),
    can(me, "lana", "view") ? supabase.rpc("care_due_list", { p_days_ahead: 14 }) : Promise.resolve({ data: null }),
    supabase.rpc("suggestions_refresh"),
    can(me, "notes", "view") ? supabase.rpc("notes_list", { p_limit: 5 }) : Promise.resolve({ data: null }),
    supabase.rpc("attendance_today"),
    can(me, "lana", "view") ? supabase.rpc("milk_list") : Promise.resolve({ data: null }),
  ]);
  const notes = notesData as NotesData | RpcError | null;
  const attendance = attData as AttendanceData | RpcError | null;
  const milkStash = milkData as MilkData | RpcError | null;
  const milkOk = milkStash && milkStash.ok ? milkStash : null;
  const household = hhData as HouseholdToday | RpcError;
  const staffToday = household.ok ? household.members.filter((m) => m.work_days.length > 0 && m.id !== me.member.id) : [];
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
  const suggestions = ((sugData as { suggestions?: Suggestion[] } | null)?.suggestions ?? []) as Suggestion[];
  const due = ((dueData as { items?: DueItem[] } | null)?.items ?? []) as DueItem[];
  const summary = sumData as HomeSummary | RpcError | null;
  const calendar = calData as CalendarData | RpcError | null;
  const todays = calendar && calendar.ok ? calendar.events.filter((e) => e.date === today) : [];

  // Entries from yesterday noon until now: the night and today, for the child's strip and current state.
  let recent: EntryRow[] = [];
  let lastMilk: string | null = null;
  let pumps: EntryRow[] = [];
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
    const evening = new Date(new Date(dayRange(addDays(today, -1), tz).from).getTime() + 18 * 3600 * 1000).toISOString();
    pumps = recent.filter((e) => e.type_id === "lana.pump" && e.occurred_at >= evening);
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
  let milkLasts: string | null = null;
  if (milkOk) {
    const safe = milkOk.bottles.filter((b) => b.location === "fridge" && !b.expired).reduce((s, b) => s + b.amount_ml, 0);
    const mf = milkForecast(safe, week);
    if (mf.usePerDay > 0) milkLasts = mf.until != null ? `lasts to ${fmtDate(new Date(mf.until).toISOString(), tz, { weekday: "short" })} ${fmtTime(new Date(mf.until).toISOString(), tz)}` : "pumping keeps up";
  }
  const feedGapMin = (summary && summary.ok ? summary.types.find((t) => t.id === "lana.feed")?.due_after_min : null) ?? 180;
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
  const showPump = me.member.breastfeeds || me.role.id === "admin";

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
  const inHouse = household.ok ? household.members.filter((m) => m.presence?.in_house).map((m) => m.name) : [];
  const vaccine = summary && summary.ok ? due.find((d) => d.kind === "vaccine" && d.subject_id === summary.subject.id) : undefined;
  const pumpedMl = pumps.reduce((a, e) => a + (Number(e.payload.amount_ml) || 0), 0);

  return (
    <div className="flex flex-col gap-4">
      {summary && summary.ok ? (
        <>
          <LanaHero summary={summary} me={me} today={today} />
          <div className="flex flex-wrap gap-2">
            {can(me, "assistant", "add") && can(me, "lana", "add") && <SayIt compact />}
            <Link href="/baby/emergency" className="chip tint-danger">
              <Icon name="phone" size={18} /> Emergency
            </Link>
            {vaccine && (
              <Link href="/baby/vaccines" className={`chip ${vaccine.overdue ? "tint-danger" : "tint-meds"}`}>
                <Icon name="syringe" size={18} /> Vaccines {vaccine.overdue ? "overdue" : "due"}
              </Link>
            )}
          </div>
          {can(me, "lana", "edit") && <EntryChecks entries={week} timezone={tz} compact canDelete={can(me, "lana", "delete")} />}
          <LanaNow subject={summary.subject} types={summary.types} ongoing={summary.ongoing} recent={recent} timezone={tz} lastMilk={lastMilk} />
          <RightNow summary={summary} milk={milkOk} timezone={tz} milkLasts={milkLasts} />
          {summary.subject.birth_date && <NextNap entries={week} ageDays={ageDays(summary.subject.birth_date, today)} timezone={tz} compact />}
          {order.map((k) => alerts[k])}
          {sitter && (
            <nav aria-label="While you are with the child" className="grid grid-cols-2 gap-2">
              <Link href="/baby?tab=handover" className="btn">
                Handover
              </Link>
              <Link href="/baby/when-to-call" className="btn">
                When to call
              </Link>
            </nav>
          )}

          <LanaGuide fold entries={week} birthDate={summary.subject.birth_date} timezone={tz} feedGapMin={feedGapMin} />
          {showPump && (
            <Fold title="Pumping" icon="droplet" tint="pump" hint={`${pumpedMl} / ${me.household.milk_target_ml ?? 400} ml`} open={part === "morning" && !!me.member.breastfeeds}>
              <PumpTarget pumps={pumps} milk={milkOk} target={me.household.milk_target_ml ?? 400} canLog={can(me, "lana", "add")} />
            </Fold>
          )}
          <Fold title="Day so far" icon="history" tint="feed" hint={`${recent.filter((e) => e.occurred_at >= dayRange(today, tz).from).length} logged`}>
            <DayStrip entries={recent} day={today} timezone={tz} nowIso={now.toISOString()} />
            <Backfill subjectId={summary.subject.id} types={summary.types} timezone={tz} day={today} entries={week} feedIntervalMin={feedGapMin} />
          </Fold>

          <nav aria-label="Shortcuts" className="grid grid-cols-4 gap-2">
            {(
              [
                { href: "/baby", icon: "baby", label: summary.subject.name, tint: "feed", hint: null },
                { href: "/baby/milk", icon: "droplet", label: "Milk", tint: "milk", hint: milkOk ? `${milkOk.fridge_ml} ml` : null },
                { href: "/baby?tab=handover", icon: "clipboard", label: "Handover", tint: "pump", hint: null },
                { href: "/baby/doctor", icon: "phone", label: "Doctor", tint: "meds", hint: null },
                { href: "/calendar", icon: "calendar", label: "Calendar", tint: "cal", hint: todays.length ? `${todays.length} today` : null },
                { href: "/notes", icon: "note", label: "Notes", tint: "notes", hint: notes && notes.ok && notes.notes.length ? `${notes.notes.length}` : null },
                { href: "/members", icon: "users", label: "Who's home", tint: "house", hint: inHouse.length ? `${inHouse.length} here` : null },
                { href: "/ask", icon: "sparkles", label: "Ask", tint: "guide", hint: null },
              ] as const
            )
              .filter((t) => (t.href === "/calendar" ? !!calendar?.ok : t.href === "/notes" ? !!notes?.ok : t.href === "/members" ? household.ok && !sitter : t.href === "/ask" ? can(me, "assistant", "view") : true))
              .map((t) => (
                <Link key={t.href} href={t.href} className={`tile tile-sm tint-${t.tint}`}>
                  <span className="icon-disc" style={{ width: 36, height: 36 }}>
                    <Icon name={t.icon} size={20} />
                  </span>
                  <span className="w-full text-xs font-bold leading-tight">{t.label}</span>
                  {t.hint && <span className="muted text-[10px] leading-none">{t.hint}</span>}
                </Link>
              ))}
          </nav>
        </>
      ) : (
        <header className="page-header page-header-large">
          <p className="muted">{fmtDate(now.toISOString(), tz, { weekday: "long", day: "numeric", month: "long" })}</p>
          <h1 className="page-title">
            {greeting}, {me.member.display_name}
          </h1>
        </header>
      )}
      {summary && !summary.ok && (
        <div className="card">
          <p>{summary.message}</p>
        </div>
      )}

      <SuggestionCards suggestions={suggestions} />
      {attendance && attendance.ok && (attendance.open.length > 0 || (can(me, "members", "edit") && staffToday.length > 0)) && (
        <div className="flex flex-wrap items-center gap-2 px-1">
          {attendance.open.map((o) => (
            <span key={o.member_id} className="pill pill-ok">
              {o.name} here since {fmtTime(o.in_at, tz)}
            </span>
          ))}
          {can(me, "members", "edit") && staffToday.map((m) => <AttendanceButton key={m.id} small memberId={m.id} name={m.name} timezone={tz} open={attendance.open.find((o) => o.member_id === m.id) ?? null} />)}
        </div>
      )}
    </div>
  );
}
