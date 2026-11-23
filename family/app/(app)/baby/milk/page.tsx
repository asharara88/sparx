import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { awayParent, awayParentOn } from "@/lib/handover";
import type { Me, MilkData, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { MilkPutAway, MilkStash } from "@/components/MilkStash";
import { PageHeader } from "@/components/PageHeader";
import { FridgePlan } from "@/components/FridgePlan";
import { MilkInsights, ThawReminder } from "@/components/MilkInsights";
import { Fold, FoldLink } from "@/components/Fold";
import { forecastHint, milkForecast, safeFridgeMl } from "@/lib/milk-insights";
import type { EntryRow, HomeSummary, HouseholdToday } from "@/lib/types";
import { WORK_FROM, WORK_TO, hhmm } from "@/lib/household";
import { addDays, dayRange, todayYmd } from "@/lib/time";
import { stageFor } from "@/lib/stage";
import { ageDays } from "@/lib/norms";
import { meOnce } from "@/lib/server/me";
import { napPattern } from "@/lib/child-insights";
import { dayFacts, dayPlan, readDay } from "@/lib/day";
import { possessive } from "@/lib/names";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

export default async function MilkPage() {
  const supabase = await createClient();
  const { data: meData } = await meOnce();
  const me = meData as Me;
  if (!can(me, "lana", "view")) redirect("/");
  const tz = me.household.timezone;
  const today = todayYmd(tz);
  const [{ data }, { data: hhData }, { data: sumData }] = await Promise.all([supabase.rpc("milk_list"), supabase.rpc("household_today"), supabase.rpc("home_summary")]);
  const subjectId = (sumData as HomeSummary | RpcError | null)?.ok ? (sumData as HomeSummary).subject.id : null;
  const { data: histData } = subjectId ? await supabase.rpc("care_entries_list", { p_subject_id: subjectId, p_from: new Date(Date.now() - 14 * 86_400_000).toISOString(), p_to: new Date(Date.now() + 3_600_000).toISOString() }) : { data: null };
  const history = ((histData as { entries?: EntryRow[] } | null)?.entries ?? []) as EntryRow[];
  const milk = data as MilkData | RpcError;
  if (!milk.ok) redirect("/");
  const hh = hhData as HouseholdToday | RpcError;
  const summary = sumData as HomeSummary | RpcError;
  const mama = hh.ok ? awayParent(hh.members) : null;
  const now = new Date();
  const hhm = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "numeric", hourCycle: "h23", timeZone: tz }).format(now).replace(":", ""));
  const from = hhmm(mama?.work_from, WORK_FROM);
  const to = hhmm(mama?.work_to, WORK_TO);
  const away = !!mama && mama.works_today && hhm >= from && hhm <= to;
  const dayStart = Date.parse(dayRange(today, tz).from);
  const backAt = new Date(dayStart + (Math.floor(to / 100) * 60 + (to % 100)) * 60_000).toISOString();
  // Tomorrow has its own away parent: two parents who work on different days each get their day.
  const tomorrowWd = new Date(Date.parse(dayRange(addDays(today, 1), tz).from) + 12 * 3_600_000).getUTCDay();
  const tomorrowsParent = hh.ok ? awayParentOn(hh.members, tomorrowWd) : null;
  const awayTomorrow = !!tomorrowsParent && tomorrowsParent.work_days.includes(tomorrowWd);
  const tFrom = hhmm(tomorrowsParent?.work_from, WORK_FROM);
  const tTo = hhmm(tomorrowsParent?.work_to, WORK_TO);
  const thaw = { awayTomorrow, awayMinutes: (Math.floor(tTo / 100) * 60 + (tTo % 100)) - (Math.floor(tFrom / 100) * 60 + (tFrom % 100)), intervalMin: milk.bottle_interval_min, hour: Math.floor(hhm / 100) };
  let lastBottleMl = 120;
  let lastFeedAt: string | null = null;
  if (summary.ok) {
    lastFeedAt = summary.last["lana.feed"]?.ended_at ?? summary.last["lana.feed"]?.occurred_at ?? null;
    const b = summary.today_entries.find((e: EntryRow) => e.type_id === "lana.feed" && e.payload.method === "Bottle");
    if (b && Number(b.payload.amount_ml)) lastBottleMl = Number(b.payload.amount_ml);
  }
  // Pumping since yesterday evening, against the day's target: it lived on Home until the
  // phone pass moved everything that is not "now" off it (DESIGN.md, "Home"); its bar
  // here opens the dashboard (sleep today, pumping, the bottles at home, the usual day).
  const evening = new Date(Date.parse(dayRange(addDays(today, -1), tz).from) + 18 * 3_600_000).toISOString();
  const pumps = history.filter((e) => e.type_id === "lana.pump" && e.occurred_at >= evening);
  const pumpedMl = pumps.reduce((a, e) => a + (Number(e.payload.amount_ml) || 0), 0);
  const target = me.household.milk_target_ml ?? 400;
  const birth = summary.ok ? summary.subject.birth_date : null;
  const stage = stageFor(birth, Date.now(), tz);
  // Stored milk only where milk is stored (R7): from 12 months a home with no bottle in stock and
  // no pump in 14 days gets no forecast, no thaw reminder and no pumping bar. A baby's always does.
  // The plan holds that rule (lib/day.ts, milkNotices); with a saved day the family must also
  // have said that milk is stored, and the feed clock is theirs to keep.
  const age = birth ? ageDays(birth, today) : null;
  const day = summary.ok ? readDay(summary.subject.settings, age, birth) : null;
  const pattern = napPattern(history, age, now.getTime(), tz, now.getTime() - 7 * 86_400_000, day?.naps ?? null);
  const plan = dayPlan(day, age, dayFacts(summary.ok ? summary : null, { now: now.getTime(), today, tz, breastfeeds: !!me.member.breastfeeds, inStock: milk.fridge_count + milk.freezer_count > 0, week: history, pattern }));
  const showPump = (!!me.member.breastfeeds || me.role.id === "admin") && plan.milkNotices;
  // The day says no milk is stored: nothing new goes into the stash until a parent says
  // otherwise. A bag already here can still be warmed, used or binned from the list.
  const closed = plan.saved && !plan.storesMilk && summary.ok;
  const whose = summary.ok ? possessive(summary.subject.name) : "";
  // As the database names them when it refuses ("Ask Mido or Dana ...").
  const admins = (hh.ok ? hh.members.filter((m) => m.role_id === "admin").map((m) => m.name) : []).join(" or ") || "an admin";
  // The forecast's answer goes on its bar, where Fridge and Freezer put theirs ("till Sat").
  const safeMl = safeFridgeMl(milk.bottles);
  const lasts = forecastHint(milkForecast(safeMl, history), safeMl, tz);
  // DESIGN.md, "Milk": what is in the fridge and freezer as lists, the plan only on a day
  // someone is away, the rest folded, "Put a bottle away" at the bottom.
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Milk" large />
      {away && plan.milkNotices && <FridgePlan milk={milk} lastFeedAt={lastFeedAt} backAtIso={backAt} bottleMl={lastBottleMl} timezone={tz} name={mama?.name ?? "Mama"} milkClock={plan.milkClock} />}
      {plan.milkNotices && <ThawReminder milk={milk} entries={history} timezone={tz} opts={thaw} />}
      <MilkStash data={milk} timezone={tz} />
      {plan.milkNotices && (
        <Fold title="Fridge lasts" icon="trend" tint="milk" hint={lasts}>
          <MilkInsights bare milk={milk} entries={history} timezone={tz} thaw={thaw} toddler={stage.toddler} />
        </Fold>
      )}
      {showPump && <FoldLink href="/#today" title="Pumping" icon="droplet" tint="pump" hint={`${pumpedMl} / ${target} ml`} />}
      {!closed && <MilkPutAway timezone={tz} canScan={can(me, "lana", "add")} />}
      {/* In its place, for whoever could have put a bottle away: a parent gets the way to the day, anyone else whom to ask. */}
      {closed &&
        can(me, "lana", "add") &&
        (me.role.id === "admin" && !me.preview ? (
          <Link prefetch={false} href="/baby/day" className="notice row-link flex items-center gap-2 no-underline">
            <span className="flex-1">
              {whose} day says no milk is stored. A parent turns it on in {whose} day.
            </span>
            <Icon name="forward" size={18} className="shrink-0" />
          </Link>
        ) : (
          <p className="notice">
            {whose} day says no milk is stored. Ask {admins}.
          </p>
        ))}
    </div>
  );
}
