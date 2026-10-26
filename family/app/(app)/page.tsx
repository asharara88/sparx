import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { awayParent, awayParentOn } from "@/lib/handover";
import type { AttendanceData, CalendarData, DueItem, EntryRow, HomeSummary, HouseholdToday, Me, MilkData, NotesData, RpcError, Suggestion } from "@/lib/types";
import { EVENT_KINDS, can } from "@/lib/types";
import { childPronouns, possessive } from "@/lib/names";
import { addDays, fmtDate, fmtTime, todayYmd, dayRange } from "@/lib/time";
import { HouseholdCard } from "@/components/HouseholdCard";
import { BriefCard } from "@/components/BriefCard";
import { SuggestionCards } from "@/components/SuggestionCards";
import { NotesBoard } from "@/components/NotesBoard";
import { AttendanceButton } from "@/components/AttendanceButton";
import { BottleCountdown } from "@/components/BottleCountdown";
import { VaccineNotice } from "@/components/VaccineNotice";
import { WORK_FROM, WORK_TO, hhmm } from "@/lib/household";
import { SimpleHome } from "@/components/SimpleHome";
import { LanaHero } from "@/components/LanaHero";
import { LanaNow } from "@/components/LanaNow";
import { RightNow } from "@/components/RightNow";
import { EmergencyRow } from "@/components/EmergencyRow";
import { LanaGuide } from "@/components/LanaGuide";
import { PumpTarget } from "@/components/PumpTarget";
import { HandoverSince } from "@/components/HandoverSince";
import { FridgePlan } from "@/components/FridgePlan";
import { DayStrip } from "@/components/DayStrip";
import { LanaForecast } from "@/components/LanaForecast";
import { SayIt } from "@/components/SayIt";
import { EntryChecks } from "@/components/EntryChecks";
import { NextNap } from "@/components/NextNap";
import { Backfill } from "@/components/Backfill";
import { ageDays } from "@/lib/norms";
import { ThawReminder } from "@/components/MilkInsights";
import { nextFeedAt } from "@/lib/forecast";
import { milkForecast } from "@/lib/milk-insights";
import { PlanCard } from "@/components/PlanCard";
import { WeekCard } from "@/components/WeekCard";
import type { CoachPlanData } from "@/lib/types";
import { Icon } from "@/components/Icon";
import { Fold } from "@/components/Fold";

export const dynamic = "force-dynamic";

/**
 * Home is the child's place and fits a phone screen: their state and the one-tap log,
 * the three "right now" tiles, then the alerts of this hour (bottles while the
 * breastfeeding parent is away, the thaw, the handover). Everything else is a fold with
 * its own colour: the guide, pumping, what is coming, the day so far, the helper, and
 * the house (who is home, today, notes). Only the fold that matters now starts open.
 */
export default async function HomePage() {
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me | null;
  if (!me || !me.ok) redirect("/login");
  // Staff get the simplest screen in the product.
  // Someone without the child's log (staff who only clock in) gets their own Today screen.
  if (!can(me, "lana", "view")) redirect("/send");

  const tz = me.household.timezone;
  const today = todayYmd(tz);
  const now = new Date();
  const pr = childPronouns(me);
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
  const tomorrows = calendar && calendar.ok ? calendar.events.filter((e) => e.date === addDays(today, 1)) : [];

  // Entries from yesterday noon until now: the night and today, for the child's strip and current state.
  let recent: EntryRow[] = [];
  let lastMilk: string | null = null;
  let pumps: EntryRow[] = [];
  if (summary && summary.ok) {
    const since = new Date(new Date(today + "T12:00:00Z").getTime() - 24 * 3600 * 1000).toISOString();
    const { data: listData } = await supabase.rpc("care_entries_list", { p_subject_id: summary.subject.id, p_from: since, p_to: new Date(Date.now() + 3600 * 1000).toISOString() });
    recent = ((listData as { entries?: EntryRow[] })?.entries ?? []) as EntryRow[];
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
  let week: EntryRow[] = recent;
  if (summary && summary.ok) {
    const { data: weekData } = await supabase.rpc("care_entries_list", { p_subject_id: summary.subject.id, p_from: new Date(Date.now() - 7 * 86_400_000).toISOString(), p_to: new Date(Date.now() + 3_600_000).toISOString() });
    week = ((weekData as { entries?: EntryRow[] } | null)?.entries ?? recent) as EntryRow[];
  }
  const awayAt = (at: number) => {
    if (!mama || !mama.works_today) return false;
    const d = new Date(at);
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(d);
    const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.find((p) => p.type === "weekday")?.value ?? "");
    const hm = Number(parts.find((p) => p.type === "hour")?.value ?? 0) * 100 + Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    return mama.work_days.includes(wd) && hm >= from && hm <= to;
  };
  const sitter = me.role.id === "sitter";
  const { data: planData } = summary && summary.ok ? await supabase.rpc("coach_plan_active", { p_subject_id: summary.subject.id }) : { data: null };
  const plan = (planData as CoachPlanData | null)?.ok ? (planData as CoachPlanData).plan : null;
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
  const aroundTheHouse = suggestions.length > 0 || (household.ok && household.members.length > 1 && (can(me, "members", "view") || can(me, "calendar", "view"))) || (calendar && calendar.ok) || (notes && notes.ok);
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
  const assistant = can(me, "assistant", "view");
  const isWeekDay = ["Sun", "Mon"].includes(new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: tz }).format(now));

  return (
    <div className="flex flex-col gap-4">
      {summary && summary.ok ? (
        <>
          <LanaHero summary={summary} me={me} today={today} dateLine={`${greeting}, ${me.member.display_name} · ${fmtDate(now.toISOString(), tz, { weekday: "long", day: "numeric", month: "long" })}`} />
          <EmergencyRow lang={(me.member.lang ?? "en") as "en" | "ar" | "ru"} />
          {due
            .filter((d) => d.kind === "vaccine" && d.subject_id === summary.subject.id)
            .slice(0, 1)
            .map((d) => (
              <VaccineNotice key={d.visit} item={d} timezone={tz} />
            ))}
          {can(me, "lana", "edit") && <EntryChecks entries={week} timezone={tz} compact canDelete={can(me, "lana", "delete")} />}
          <LanaNow subject={summary.subject} types={summary.types} ongoing={summary.ongoing} recent={recent} timezone={tz} lastMilk={lastMilk} />
          {can(me, "assistant", "add") && can(me, "lana", "add") && <SayIt />}
          <RightNow summary={summary} milk={milkOk} timezone={tz} milkLasts={milkLasts} />
          {summary.subject.birth_date && <NextNap entries={week} ageDays={ageDays(summary.subject.birth_date, today)} timezone={tz} compact />}
          {order.map((k) => alerts[k])}
          {sitter && (
            <section className="card tint-guide" aria-labelledby="sit-h">
              <h2 id="sit-h" className="text-lg font-semibold">
                While you are with {pr.them}
              </h2>
              <p className="muted mt-1 text-sm">Everything you need is here: what {summary.subject.name} has had, when to call, and who to call.</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Link href="/baby?tab=handover" className="btn">
                  Handover
                </Link>
                <Link href="/baby/when-to-call" className="btn">
                  When to call
                </Link>
                <Link href="/baby/emergency" className="btn">
                  Emergency
                </Link>
                <Link href="/ask" className="btn">
                  Ask the helper
                </Link>
              </div>
            </section>
          )}

          <LanaGuide fold entries={week} birthDate={summary.subject.birth_date} timezone={tz} feedGapMin={feedGapMin} />
          {showPump && (
            <Fold title="Pumping" icon="droplet" tint="pump" hint={`${pumps.reduce((a, e) => a + (Number(e.payload.amount_ml) || 0), 0)} ml since last evening`} open={part === "morning" && !!me.member.breastfeeds}>
              <PumpTarget pumps={pumps} milk={milkOk} target={me.household.milk_target_ml ?? 400} canLog={can(me, "lana", "add")} />
            </Fold>
          )}
          <Fold title="Coming up" icon="clock" tint="sleep" hint="next few hours">
            <LanaForecast bare entries={week} timezone={tz} away={awayAt} feedIntervalMin={feedGapMin} hours={12} />
            <PlanCard plan={plan} />
          </Fold>
          <Fold title={`${possessive(summary.subject.name)} day so far`} icon="history" tint="feed" hint={`${recent.filter((e) => e.occurred_at >= dayRange(today, tz).from).length} logged`}>
            <DayStrip entries={recent} day={today} timezone={tz} nowIso={now.toISOString()} />
            <Backfill subjectId={summary.subject.id} types={summary.types} timezone={tz} day={today} entries={week} feedIntervalMin={feedGapMin} />
          </Fold>
          {assistant && (
            <Fold title="The helper's brief" icon="sparkles" tint="guide" hint={hour < 12 ? "this morning" : "today, in short"}>
              <BriefCard hour={hour} />
              {isWeekDay && <WeekCard name={summary.subject.name} />}
            </Fold>
          )}

          <nav aria-label="Shortcuts" className="grid grid-cols-4 gap-2">
            {(
              [
                { href: "/baby", icon: "baby", label: summary.subject.name, tint: "feed" },
                { href: "/baby/milk", icon: "droplet", label: "Milk", tint: "milk" },
                { href: "/baby?tab=handover", icon: "clipboard", label: "Handover", tint: "pump" },
                { href: "/baby/doctor", icon: "phone", label: "Doctor", tint: "meds" },
              ] as const
            ).map((t) => (
              <Link key={t.href} href={t.href} className={`tile tile-sm tint-${t.tint}`}>
                <span className="icon-disc" style={{ width: 36, height: 36 }}>
                  <Icon name={t.icon} size={20} />
                </span>
                <span className="w-full text-xs font-bold leading-tight">{t.label}</span>
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

      {aroundTheHouse && !sitter && (
        <h2 className="section-title mt-2 flex items-center gap-2">
          <Icon name="house" size={18} /> Around the house
        </h2>
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
      {household.ok && !sitter && (
        <Fold title="Who is home" icon="users" tint="house" hint={inHouse.length ? inHouse.join(", ") : "nobody marked"}>
          <HouseholdCard data={household} me={me} bare />
        </Fold>
      )}
      {calendar && calendar.ok && (
        <Fold title="Today" icon="calendar" tint="cal" hint={todays.length === 0 ? "nothing planned" : `${todays.length} planned`} open={todays.length > 0}>
          {todays.length === 0 ? (
            <p className="muted">Nothing planned today.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {todays.map((e) => (
                <li key={e.id + e.starts_at}>
                  <span aria-hidden>{EVENT_KINDS.find((k) => k.id === e.kind)?.icon} </span>
                  <b>{e.all_day ? "All day" : fmtTime(e.starts_at, tz)}</b> · {e.title}
                  {e.assigned_name ? ` · ${e.assigned_name}` : ""}
                </li>
              ))}
            </ul>
          )}
          {tomorrows.length > 0 && <p className="muted text-sm">Tomorrow: {tomorrows.map((e) => e.title).join(", ")}</p>}
          <Link href="/calendar" className="text-sm font-semibold underline">
            Calendar ›
          </Link>
        </Fold>
      )}
      {notes && notes.ok && (
        <Fold title="Notes" icon="note" tint="notes" hint={notes.notes.length === 0 ? "none yet" : `${notes.notes.length} recent`}>
          <NotesBoard notes={notes.notes} compact bare />
        </Fold>
      )}
    </div>
  );
}
