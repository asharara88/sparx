import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { CalendarData, DueItem, EntryRow, HomeSummary, HouseholdToday, MaintenanceOverview, Me, RpcError, ShoppingData } from "@/lib/types";
import { EVENT_KINDS, can } from "@/lib/types";
import { addDays, fmtDate, fmtTime, todayYmd } from "@/lib/time";
import { LanaCard } from "@/components/LanaCard";
import { HouseholdCard } from "@/components/HouseholdCard";
import { FantaCard } from "@/components/FantaCard";
import { HouseCard } from "@/components/HouseCard";

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
  const [{ data: hhData }, { data: sumData }, { data: calData }, { data: shopData }, { data: fantaData }, { data: dueData }, { data: houseData }] = await Promise.all([
    supabase.rpc("household_today"),
    can(me, "lana", "view") ? supabase.rpc("home_summary") : Promise.resolve({ data: null }),
    can(me, "calendar", "view") ? supabase.rpc("calendar_list", { p_from: today, p_to: addDays(today, 1) }) : Promise.resolve({ data: null }),
    can(me, "shopping_review", "view") ? supabase.rpc("shopping_list") : Promise.resolve({ data: null }),
    fantaId ? supabase.rpc("home_summary", { p_subject_id: fantaId }) : Promise.resolve({ data: null }),
    can(me, "fanta", "view") || can(me, "lana", "view") ? supabase.rpc("care_due_list", { p_days_ahead: 14 }) : Promise.resolve({ data: null }),
    can(me, "maintenance", "view") ? supabase.rpc("maintenance_overview") : Promise.resolve({ data: null }),
  ]);
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
  if (summary && summary.ok) {
    const from = new Date(new Date(today + "T12:00:00Z").getTime() - 24 * 3600 * 1000).toISOString();
    const { data: listData } = await supabase.rpc("care_entries_list", { p_subject_id: summary.subject.id, p_from: from, p_to: new Date(Date.now() + 3600 * 1000).toISOString() });
    recent = ((listData as { entries?: EntryRow[] })?.entries ?? []) as EntryRow[];
    const lastBottle = recent.find((e) => e.type_id === "lana.feed" && e.payload.method === "Bottle" && typeof e.payload.milk === "string");
    lastMilk = (lastBottle?.payload.milk as string | undefined) ?? null;
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="pt-2">
        <p className="muted">{fmtDate(now.toISOString(), tz, { weekday: "long", day: "numeric", month: "long" })}</p>
        <h1 className="text-3xl font-bold">
          {greeting}, {me.member.display_name}
        </h1>
      </header>

      {pending > 0 && can(me, "shopping_review", "edit") && (
        <Link href="/shopping/requests" className="rounded-2xl border-2 border-amber-700 bg-amber-50 p-4 font-semibold text-amber-900">
          {pending} running-low {pending === 1 ? "request" : "requests"} from Lilly to check ›
        </Link>
      )}

      {summary && summary.ok && <LanaCard summary={summary} recent={recent} lastMilk={lastMilk} />}
      {summary && !summary.ok && (
        <div className="card">
          <p>{summary.message}</p>
        </div>
      )}

      {household.ok && <HouseholdCard data={household} me={me} />}

      {fanta && fanta.ok && <FantaCard summary={fanta} due={due} compact />}

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
