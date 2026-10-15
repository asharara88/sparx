import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AttendanceData, CalendarData, DueItem, EntryRow, HomeSummary, HouseholdToday, MaintenanceOverview, Me, MilkData, NotesData, RoutinesData, RpcError, ShoppingData, Suggestion } from "@/lib/types";
import { EVENT_KINDS, can } from "@/lib/types";
import { addDays, fmtDate, fmtTime, todayYmd, dayRange } from "@/lib/time";
import { HouseholdCard } from "@/components/HouseholdCard";
import { FantaCard } from "@/components/FantaCard";
import { HouseCard } from "@/components/HouseCard";
import { BriefCard } from "@/components/BriefCard";
import { SuggestionCards } from "@/components/SuggestionCards";
import { NotesBoard } from "@/components/NotesBoard";
import { AttendanceButton } from "@/components/AttendanceButton";
import { BottleCountdown } from "@/components/BottleCountdown";
import { VaccineNotice } from "@/components/VaccineNotice";
import { RoutineTiles } from "@/components/RoutineTiles";
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
import { ageDays } from "@/lib/norms";
import { ThawReminder } from "@/components/MilkInsights";
import { nextFeedAt } from "@/lib/forecast";
import { milkForecast } from "@/lib/milk-insights";
import { PlanCard } from "@/components/PlanCard";
import { WeekCard } from "@/components/WeekCard";
import type { CoachPlanData } from "@/lib/types";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

/**
 * Home is Lana's place. Her state and the one-tap log come first, then what
 * matters at this hour (bottles while Mama is away, pumping, the handover),
 * then her guide. The rest of the house sits below a divider.
 */
export default async function HomePage() {
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me | null;
  if (!me || !me.ok) redirect("/login");
  // Staff get the simplest screen in the product.
  if (!can(me, "lana", "view") && can(me, "shopping_requests", "add")) redirect("/send");

  const tz = me.household.timezone;
  const today = todayYmd(tz);
  const now = new Date();
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(now));
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const { data: fantaSubj } = can(me, "fanta", "view")
    ? await supabase.from("care_subjects").select("id").eq("module_id", "fanta").eq("is_active", true).order("sort").limit(1).maybeSingle()
    : { data: null };
  const fantaId = (fantaSubj as { id: string } | null)?.id ?? null;
  const [{ data: hhData }, { data: sumData }, { data: calData }, { data: shopData }, { data: fantaData }, { data: dueData }, { data: houseData }, { data: sugData }, { data: notesData }, { data: attData }, { data: milkData }, { data: routData }] = await Promise.all([
    supabase.rpc("household_today"),
    can(me, "lana", "view") ? supabase.rpc("home_summary") : Promise.resolve({ data: null }),
    can(me, "calendar", "view") ? supabase.rpc("calendar_list", { p_from: today, p_to: addDays(today, 1) }) : Promise.resolve({ data: null }),
    can(me, "shopping_review", "view") ? supabase.rpc("shopping_list") : Promise.resolve({ data: null }),
    fantaId ? supabase.rpc("home_summary", { p_subject_id: fantaId }) : Promise.resolve({ data: null }),
    can(me, "fanta", "view") || can(me, "lana", "view") ? supabase.rpc("care_due_list", { p_days_ahead: 14 }) : Promise.resolve({ data: null }),
    can(me, "maintenance", "view") ? supabase.rpc("maintenance_overview") : Promise.resolve({ data: null }),
    supabase.rpc("suggestions_refresh"),
    can(me, "notes", "view") ? supabase.rpc("notes_list", { p_limit: 5 }) : Promise.resolve({ data: null }),
    supabase.rpc("attendance_today"),
    can(me, "lana", "view") ? supabase.rpc("milk_list") : Promise.resolve({ data: null }),
    fantaId ? supabase.rpc("routines_list", { p_subject_id: fantaId }) : Promise.resolve({ data: null }),
  ]);
  const notes = notesData as NotesData | RpcError | null;
  const attendance = attData as AttendanceData | RpcError | null;
  const milkStash = milkData as MilkData | RpcError | null;
  const milkOk = milkStash && milkStash.ok ? milkStash : null;
  const routines = routData as RoutinesData | RpcError | null;
  const household = hhData as HouseholdToday | RpcError;
  const staffToday = household.ok ? household.members.filter((m) => m.work_days.length > 0 && m.id !== me.member.id) : [];
  // Mama is away: the breastfeeding member works today and it is within her hours.
  const hhm = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "numeric", hourCycle: "h23", timeZone: tz }).format(now).replace(":", ""));
  const mama = household.ok ? household.members.find((m) => m.breastfeeds) ?? null : null;
  const mamaWorks = !!mama && mama.works_today;
  const from = hhmm(mama?.work_from, WORK_FROM);
  const to = hhmm(mama?.work_to, WORK_TO);
  const mamaAway = mamaWorks && hhm >= from && hhm <= to;
  const dayStart = Date.parse(dayRange(today, tz).from);
  const atLocal = (h: number) => new Date(dayStart + (Math.floor(h / 100) * 60 + (h % 100)) * 60_000).toISOString();
  const part: "morning" | "away" | "evening" | "night" = hour < 6 || hour >= 21 ? "night" : mamaWorks && hhm < from ? "morning" : mamaAway ? "away" : "evening";
  const suggestions = ((sugData as { suggestions?: Suggestion[] } | null)?.suggestions ?? []) as Suggestion[];
  const fanta = fantaData as HomeSummary | RpcError | null;
  const due = ((dueData as { items?: DueItem[] } | null)?.items ?? []) as DueItem[];
  const house = houseData as MaintenanceOverview | RpcError | null;
  const summary = sumData as HomeSummary | RpcError | null;
  const calendar = calData as CalendarData | RpcError | null;
  const shopping = shopData as ShoppingData | RpcError | null;
  const todays = calendar && calendar.ok ? calendar.events.filter((e) => e.date === today) : [];
  const tomorrows = calendar && calendar.ok ? calendar.events.filter((e) => e.date === addDays(today, 1)) : [];
  const pending = shopping && shopping.ok ? shopping.pending_requests : 0;

  // Entries from yesterday noon until now: the night and today, for Lana's strip and her current state.
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
    const foodType = fanta && fanta.ok ? fanta.types.find((t) => t.key === "food") : null;
    const foodDefault = (foodType?.fields.find((f) => f.key === "food")?.default as string | undefined) ?? "½ wet pouch";
    return <SimpleHome summary={summary} recent={recent} milk={milkOk} fantaFood={fanta && fanta.ok && foodType ? { subjectId: fanta.subject.id, typeId: foodType.id, food: foodDefault } : null} />;
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
  const awayTomorrow = !!mama && mama.work_days.includes(new Date(Date.parse(dayRange(addDays(today, 1), tz).from) + 12 * 3_600_000).getUTCDay());
  const thawOpts = { awayTomorrow, awayMinutes: (Math.floor(to / 100) * 60 + (to % 100)) - (Math.floor(from / 100) * 60 + (from % 100)), intervalMin: bottleGapMin, hour };
  const aroundTheHouse = suggestions.length > 0 || (pending > 0 && can(me, "shopping_review", "edit")) || (household.ok && household.members.length > 1 && (can(me, "members", "view") || can(me, "calendar", "view"))) || (calendar && calendar.ok) || (notes && notes.ok) || (fanta && fanta.ok) || (house && house.ok) || can(me, "shopping", "view");
  const lastBottleMl = Number(recent.find((e) => e.type_id === "lana.feed" && e.payload.method === "Bottle")?.payload.amount_ml) || 120;
  const showPump = me.member.breastfeeds || me.role.id === "admin";

  // What matters at this hour, in order.
  const blocks: Record<string, React.ReactNode> =
    summary && summary.ok
      ? {
          countdown: milkOk ? <BottleCountdown key="c" milk={milkOk} lastFeedAt={lastFeedAt} mamaAway={mamaAway} timezone={tz} nextAtIso={nextBottle ? new Date(nextBottle.at).toISOString() : null} /> : null,
          thaw: milkOk ? <ThawReminder key="th" milk={milkOk} entries={week} timezone={tz} opts={thawOpts} /> : null,
          plan: milkOk && mamaAway ? <FridgePlan key="fp" milk={milkOk} lastFeedAt={lastFeedAt} backAtIso={atLocal(to)} bottleMl={lastBottleMl} timezone={tz} /> : null,
          pump: showPump ? <PumpTarget key="pt" pumps={pumps} milk={milkOk} target={me.household.milk_target_ml ?? 400} canLog={can(me, "lana", "add")} /> : null,
          handover:
            mamaWorks && (part === "away" || part === "evening") && hhm >= from ? (
              <HandoverSince key="h" entries={recent} fromIso={atLocal(from)} toIso={part === "away" ? now.toISOString() : atLocal(to)} label={part === "away" ? `Since ${mama?.name ?? "Mama"} left at ${fmtTime(atLocal(from), tz)}` : `While ${mama?.name ?? "Mama"} was at work`} />
            ) : null,
          guide: <LanaGuide key="g" entries={week} birthDate={summary.subject.birth_date} timezone={tz} feedGapMin={feedGapMin} />,
          brief: can(me, "assistant", "view") ? <BriefCard key="b" hour={hour} /> : null,
          week: can(me, "assistant", "view") && ["Sun", "Mon"].includes(new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: tz }).format(now)) ? <WeekCard key="w" name={summary.subject.name} /> : null,
          strip: <DayStrip key="s" entries={recent} day={today} timezone={tz} nowIso={now.toISOString()} title="Lana's day so far" />,
        }
      : {};
  const order =
    part === "morning" ? ["brief", "week", "pump", "guide", "countdown", "strip"]
    : part === "away" ? ["countdown", "plan", "handover", "guide", "pump", "strip", "brief", "week"]
    : part === "evening" ? ["thaw", "handover", "guide", "pump", "strip", "brief", "week", "countdown"]
    : ["thaw", "guide", "strip", "countdown", "brief", "week"];

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
          {can(me, "lana", "edit") && <EntryChecks entries={week} timezone={tz} limit={2} canDelete={can(me, "lana", "delete")} />}
          <LanaNow subject={summary.subject} types={summary.types} ongoing={summary.ongoing} recent={recent} timezone={tz} lastMilk={lastMilk} />
          {summary.subject.birth_date && <NextNap entries={week} ageDays={ageDays(summary.subject.birth_date, today)} timezone={tz} compact />}
          {can(me, "assistant", "add") && can(me, "lana", "add") && <SayIt />}
          <RightNow summary={summary} milk={milkOk} timezone={tz} milkLasts={milkLasts} />
          <PlanCard plan={plan} />
          <LanaForecast entries={week} timezone={tz} away={awayAt} feedIntervalMin={summary.types.find((t) => t.id === "lana.feed")?.due_after_min ?? 180} hours={6} limit={3} compact />
          {sitter && (
            <section className="card" aria-labelledby="sit-h">
              <h2 id="sit-h" className="text-lg font-semibold">
                While you are with her
              </h2>
              <p className="muted mt-1 text-sm">Everything you need is here: what she has had, when to call, and who to call.</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Link href="/lana?tab=handover" className="btn">
                  Handover
                </Link>
                <Link href="/lana/when-to-call" className="btn">
                  When to call
                </Link>
                <Link href="/lana/emergency" className="btn">
                  Emergency
                </Link>
                <Link href="/ask" className="btn">
                  Ask the helper
                </Link>
              </div>
            </section>
          )}
          {order.map((k) => blocks[k])}
          <div className="grid grid-cols-4 gap-2">
            <Link href="/lana" className="btn">
              Lana
            </Link>
            <Link href="/lana/milk" className="btn">
              Milk
            </Link>
            <Link href="/lana?tab=handover" className="btn">
              Handover
            </Link>
            <Link href="/lana/doctor" className="btn">
              Doctor
            </Link>
          </div>
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
      {pending > 0 && can(me, "shopping_review", "edit") && (
        <Link href="/shopping/requests" className="notice notice-warn font-semibold">
          {pending} running-low {pending === 1 ? "request" : "requests"} from Lilly to check ›
        </Link>
      )}
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
      {household.ok && !sitter && <HouseholdCard data={household} me={me} />}
      {calendar && calendar.ok && (
        <section className="card" aria-labelledby="today-h">
          <div className="flex items-baseline justify-between">
            <h2 id="today-h" className="text-xl font-semibold">
              Today
            </h2>
            <Link href="/calendar" className="text-sm font-semibold text-[var(--accent)]">
              Calendar ›
            </Link>
          </div>
          {todays.length === 0 ? (
            <p className="muted mt-1">Nothing planned today.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1">
              {todays.map((e) => (
                <li key={e.id + e.starts_at}>
                  <span aria-hidden>{EVENT_KINDS.find((k) => k.id === e.kind)?.icon} </span>
                  <b>{e.all_day ? "All day" : fmtTime(e.starts_at, tz)}</b> · {e.title}
                  {e.assigned_name ? ` · ${e.assigned_name}` : ""}
                </li>
              ))}
            </ul>
          )}
          {tomorrows.length > 0 && <p className="muted mt-2 text-sm">Tomorrow: {tomorrows.map((e) => e.title).join(", ")}</p>}
        </section>
      )}
      {notes && notes.ok && <NotesBoard notes={notes.notes} compact />}
      {fanta && fanta.ok && <FantaCard summary={fanta} due={due} compact />}
      {routines && routines.ok && routines.routines.some((r) => r.days_left != null && r.days_left <= 0) && <RoutineTiles routines={routines.routines.filter((r) => r.days_left != null && r.days_left <= 0)} module="fanta" />}
      {house && house.ok && <HouseCard data={house} />}
      {can(me, "shopping", "view") && (
        <Link href="/shopping" className="row-link card-flat flex items-center gap-3">
          <Icon name="cart" size={20} />
          <span className="flex-1 font-semibold">Shopping list</span>
          <Icon name="forward" size={18} className="muted" />
        </Link>
      )}
    </div>
  );
}
