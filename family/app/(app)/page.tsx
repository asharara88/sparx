import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AttendanceData, CalendarData, DueItem, EntryRow, HomeSummary, HouseholdToday, MaintenanceOverview, Me, MilkData, NotesData, RoutinesData, RpcError, ShoppingData, Suggestion } from "@/lib/types";
import { EVENT_KINDS, can } from "@/lib/types";
import { addDays, fmtDate, fmtTime, todayYmd, dayRange } from "@/lib/time";
import { LanaCard } from "@/components/LanaCard";
import { HouseholdCard } from "@/components/HouseholdCard";
import { FantaCard } from "@/components/FantaCard";
import { HouseCard } from "@/components/HouseCard";
import { BriefCard } from "@/components/BriefCard";
import { SuggestionCards } from "@/components/SuggestionCards";
import { NotesBoard } from "@/components/NotesBoard";
import { AttendanceButton } from "@/components/AttendanceButton";
import { BottleCountdown } from "@/components/BottleCountdown";
import { RoutineTiles } from "@/components/RoutineTiles";
import { WORK_FROM, WORK_TO } from "@/lib/household";
import { SimpleHome } from "@/components/SimpleHome";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
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
  const routines = routData as RoutinesData | RpcError | null;
  // Staff who are not here now, for the admin's "is here" button (only those with work days).
  const staffToday = hhData && (hhData as HouseholdToday).ok ? (hhData as HouseholdToday).members.filter((m) => m.work_days.length > 0 && m.id !== me.member.id) : [];
  // Mama is away: the breastfeeding member works today and it is within her hours.
  const hhm = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "numeric", hourCycle: "h23", timeZone: tz }).format(now).replace(":", ""));
  const { data: mamaRows } = can(me, "lana", "view") ? await supabase.from("members").select("id").eq("breastfeeds", true).eq("is_active", true) : { data: null };
  const mamaIds = new Set(((mamaRows as { id: string }[] | null) ?? []).map((r) => r.id));
  const mamaAway = hhData && (hhData as HouseholdToday).ok ? (hhData as HouseholdToday).members.some((m) => mamaIds.has(m.id) && m.works_today) && hhm >= WORK_FROM && hhm <= WORK_TO : false;
  const suggestions = ((sugData as { suggestions?: Suggestion[] } | null)?.suggestions ?? []) as Suggestion[];
  const fanta = fantaData as HomeSummary | RpcError | null;
  const due = ((dueData as { items?: DueItem[] } | null)?.items ?? []) as DueItem[];
  const house = houseData as MaintenanceOverview | RpcError | null;
  const household = hhData as HouseholdToday | RpcError;
  const summary = sumData as HomeSummary | RpcError | null;
  const calendar = calData as CalendarData | RpcError | null;
  const shopping = shopData as ShoppingData | RpcError | null;
  const todays = calendar && calendar.ok ? calendar.events.filter((e) => e.date === today) : [];
  const tomorrows = calendar && calendar.ok ? calendar.events.filter((e) => e.date === addDays(today, 1)) : [];
  const pending = shopping && shopping.ok ? shopping.pending_requests : 0;

  // Entries from yesterday noon until now: the night and today, for Lana's strip and her current state.
  let recent: EntryRow[] = [];
  let lastMilk: string | null = null;
  let milk: { pumped: number; given: number; target: number; any: boolean } | null = null;
  if (summary && summary.ok) {
    const from = new Date(new Date(today + "T12:00:00Z").getTime() - 24 * 3600 * 1000).toISOString();
    const { data: listData } = await supabase.rpc("care_entries_list", { p_subject_id: summary.subject.id, p_from: from, p_to: new Date(Date.now() + 3600 * 1000).toISOString() });
    recent = ((listData as { entries?: EntryRow[] })?.entries ?? []) as EntryRow[];
    const lastBottle = recent.find((e) => e.type_id === "lana.feed" && e.payload.method === "Bottle" && typeof e.payload.milk === "string");
    lastMilk = (lastBottle?.payload.milk as string | undefined) ?? null;
    // Milk for the day: pumped since yesterday evening, minus what went into bottles today.
    const evening = new Date(new Date(dayRange(addDays(today, -1), tz).from).getTime() + 18 * 3600 * 1000).toISOString();
    const startToday = dayRange(today, tz).from;
    const ml = (e: EntryRow) => Number(e.payload.amount_ml) || 0;
    milk = {
      pumped: recent.filter((e) => e.type_id === "lana.pump" && e.occurred_at >= evening).reduce((a, e) => a + ml(e), 0),
      given: recent.filter((e) => e.type_id === "lana.feed" && e.occurred_at >= startToday && e.payload.method === "Bottle" && /pumped/i.test(String(e.payload.milk ?? ""))).reduce((a, e) => a + ml(e), 0),
      target: me.household.milk_target_ml ?? 400,
      any: recent.some((e) => e.type_id === "lana.pump" || (e.type_id === "lana.feed" && e.payload.method === "Bottle")),
    };
  }

  if (me.member.simple_mode && summary && summary.ok) {
    const foodType = fanta && fanta.ok ? fanta.types.find((t) => t.key === "food") : null;
    const foodDefault = (foodType?.fields.find((f) => f.key === "food")?.default as string | undefined) ?? "½ wet pouch";
    return (
      <SimpleHome
        summary={summary}
        recent={recent}
        milk={milkStash && milkStash.ok ? milkStash : null}
        fantaFood={fanta && fanta.ok && foodType ? { subjectId: fanta.subject.id, typeId: foodType.id, food: foodDefault } : null}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="page-header page-header-large">
        <p className="muted">{fmtDate(now.toISOString(), tz, { weekday: "long", day: "numeric", month: "long" })}</p>
        <h1 className="page-title">
          {greeting}, {me.member.display_name}
        </h1>
      </header>

      {can(me, "assistant", "view") && <BriefCard hour={hour} />}

      <SuggestionCards suggestions={suggestions} />

      {pending > 0 && can(me, "shopping_review", "edit") && (
        <Link href="/shopping/requests" className="notice notice-warn font-semibold">
          {pending} running-low {pending === 1 ? "request" : "requests"} from Lilly to check ›
        </Link>
      )}

      {summary && summary.ok && <LanaCard summary={summary} recent={recent} lastMilk={lastMilk} milk={milk} />}
      {summary && summary.ok && milkStash && milkStash.ok && (
        <BottleCountdown milk={milkStash} lastFeedAt={summary.last["lana.feed"]?.ended_at ?? summary.last["lana.feed"]?.occurred_at ?? null} mamaAway={mamaAway} timezone={tz} />
      )}
      {attendance && attendance.ok && (attendance.open.length > 0 || (can(me, "members", "edit") && staffToday.length > 0)) && (
        <div className="flex flex-wrap items-center gap-2 px-1">
          {attendance.open.map((o) => (
            <span key={o.member_id} className="pill pill-ok">
              {o.name} here since {fmtTime(o.in_at, tz)}
            </span>
          ))}
          {can(me, "members", "edit") &&
            staffToday.map((m) => (
              <AttendanceButton key={m.id} small memberId={m.id} name={m.name} timezone={tz} open={attendance.open.find((o) => o.member_id === m.id) ?? null} />
            ))}
        </div>
      )}
      {notes && notes.ok && <NotesBoard notes={notes.notes} compact />}
      {summary && !summary.ok && (
        <div className="card">
          <p>{summary.message}</p>
        </div>
      )}

      {household.ok && <HouseholdCard data={household} me={me} />}

      {fanta && fanta.ok && <FantaCard summary={fanta} due={due} compact />}
      {routines && routines.ok && routines.routines.some((r) => r.days_left != null && r.days_left <= 0) && (
        <RoutineTiles routines={routines.routines.filter((r) => r.days_left != null && r.days_left <= 0)} module="fanta" />
      )}

      {house && house.ok && <HouseCard data={house} />}

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
          {tomorrows.length > 0 && (
            <p className="muted mt-2 text-sm">
              Tomorrow: {tomorrows.map((e) => e.title).join(", ")}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
