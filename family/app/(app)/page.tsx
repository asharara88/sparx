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
import { LogMenu } from "@/components/LogMenu";
import { feedGapFor } from "@/lib/stage";
import { HandoverSince } from "@/components/HandoverSince";
import { FridgePlan } from "@/components/FridgePlan";
import { ageDays } from "@/lib/norms";
import { ThawReminder } from "@/components/MilkInsights";
import { nextFeedAt } from "@/lib/forecast";
import { Icon } from "@/components/Icon";
import { meOnce } from "@/lib/server/me";
import { HomeHeader } from "@/components/HomeHeader";
import { TellBar } from "@/components/TellBar";
import { Celebration, type FreshBadge } from "@/components/Celebration";
import type { Cheer } from "@/lib/cheers";
import { andList, latestNight, memberNight, nightName, nightOf } from "@/lib/nights";
import { NightAsk } from "@/components/NightAsk";
import { NightNotice } from "@/components/NightNotice";
import { runNudge, type BadgeNumbers } from "@/lib/achievements";
import { quickContextOf } from "@/lib/assistant/quick-context";
import { HomeState } from "@/components/HomeState";
import { DueNotice } from "@/components/DueNotice";
import { napPattern, nextNap } from "@/lib/child-insights";
import { checkEntries } from "@/lib/entry-checks";
import { TodayStrip } from "@/components/TodayStrip";
import { NowMore } from "@/components/NowMore";
import { SleepDay } from "@/components/SleepDay";
import { FeedDay } from "@/components/FeedDay";
import { FoodDay } from "@/components/FoodDay";
import { PumpDashboard } from "@/components/PumpDashboard";
import type { PumpDay } from "@/lib/pumping";
import { nightWindow } from "@/lib/night";
import { isToddler, limitsFor, pumpingActive, stageFor } from "@/lib/stage";
import { tipsFor } from "@/lib/child-guide";
import { child, pronouns } from "@/lib/names";
import { defaultMilk } from "@/lib/milk-take";
import { dayFacts, dayOffer, dayPlan, readDay } from "@/lib/day";

export const dynamic = "force-dynamic";

/**
 * Home answers "what does she need now, and what do I tap?" on its first phone screen
 * (DESIGN.md, "Home"): the header (photo, name, who has her, Emergency); a card with her
 * state, awake as the next-nap window; the day in up to three counts, naps and feeds opening
 * their sections; one Now notice, the first that applies (the guide's top tip among them),
 * with "More" for the rest; and a row per activity at the thumb, each saying when it last
 * happened with its round button (solid acts at once, a soft plus opens the sheet).
 * Below the rows, the day's picture (Mido, 7 November: Home and the dashboard are one):
 * sleep today, feeds today, food once she eats, pumping while it goes on.
 * From 12 months a parent may have saved "{Name}'s day" (lib/day.ts): one plan is built from
 * it here and the strip, the notices, the cards and the log sheet all read that plan. With
 * no day the plan is the rules as they were.
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

  // The child's age on the home's calendar (null with no birth date: a baby, as always).
  const age = summary && summary.ok && summary.subject.birth_date ? ageDays(summary.subject.birth_date, today) : null;
  // A week of entries for the forecast; the "recent" list only covers the last day.
  const week: EntryRow[] = weekRows ?? recent;
  const inStock = !!milkOk && milkOk.fridge_count + milkOk.freezer_count > 0;
  // "{Name}'s day", when a parent has saved one and it counts at this age; null for a baby
  // and for a home that has not saved one, and then everything below is as it was.
  const day = summary && summary.ok ? readDay(summary.subject.settings, age, summary.subject.birth_date) : null;
  // Does the child nap, and how often (R5): a toddler's own week decides, or the family's
  // answer once they have given one; a baby always naps.
  const pattern = napPattern(week, age, now.getTime(), tz, now.getTime() - 7 * 86_400_000, day?.naps ?? null);
  // The plan, built once (lib/day.ts): milk on a clock or not, where the stored-milk notices
  // speak, the strip's cells, the "since Mama left" tiles and what the log sheet offers.
  const plan = dayPlan(day, age, dayFacts(summary && summary.ok ? summary : null, { now: now.getTime(), today, tz, breastfeeds: !!me.member.breastfeeds, inStock, week, pattern }));

  if (me.member.simple_mode && summary && summary.ok) {
    // The simple screen reads the two milk answers only, and only with a saved day; neither rests on the week, which it does not fetch.
    return <SimpleHome summary={summary} recent={recent} milk={milkOk} plan={{ saved: plan.saved, milkClock: plan.milkClock, milkNotices: plan.milkNotices }} />;
  }

  const lastFeedAt = summary && summary.ok ? (summary.last["lana.feed"]?.ended_at ?? summary.last["lana.feed"]?.occurred_at ?? null) : null;
  const stage = summary && summary.ok ? stageFor(summary.subject.birth_date, Date.now(), tz) : null;
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
  // While Mama is away the bottle interval is the gap, shortened after a small bottle. From 12
  // months milk has no clock (R2), so no bottle countdown, fridge plan or "feed due", unless
  // the family's day keeps the clock and milk is still logged (plan.milkClock).
  const nextBottle = mamaAway && plan.milkClock ? nextFeedAt(week, { gapMin: bottleGapMin, awayCapMin: bottleGapMin, away: awayAt }) : null;
  // Tomorrow has its own away parent: two parents who work on different days each get their day.
  const tomorrowWd = new Date(Date.parse(dayRange(addDays(today, 1), tz).from) + 12 * 3_600_000).getUTCDay();
  const tomorrowsParent = household.ok ? awayParentOn(household.members, tomorrowWd) : null;
  const awayTomorrow = !!tomorrowsParent && tomorrowsParent.work_days.includes(tomorrowWd);
  const tFrom = hhmm(tomorrowsParent?.work_from, WORK_FROM);
  const tTo = hhmm(tomorrowsParent?.work_to, WORK_TO);
  const thawOpts = { awayTomorrow, awayMinutes: (Math.floor(tTo / 100) * 60 + (tTo % 100)) - (Math.floor(tFrom / 100) * 60 + (tFrom % 100)), intervalMin: bottleGapMin, hour };
  const lastBottleMl = Number(recent.find((e) => e.type_id === "lana.feed" && e.payload.method === "Bottle")?.payload.amount_ml) || 120;

  // ---- below the rows: the day's picture (what /baby/dashboard showed until 7 November).
  const showFood = !!stage && !!summary && summary.ok && (stage.solids || !!summary.last["lana.meal"]);
  const pumping = !!summary && summary.ok && pumpingActive(summary.last["lana.pump"]?.occurred_at ?? null, now.getTime(), age);
  // The pumping card while pumping goes on or milk is in stock; with a saved day, where the family says milk is stored.
  const showPump = !!summary && summary.ok && (!!me.member.breastfeeds || me.role.id === "admin") && (plan.saved ? plan.storesMilk : pumping || inStock);
  // The milk the Feed sheet starts on (X10): a home that never pumped or kept milk is not told it gave pumped milk.
  const firstMilk = summary && summary.ok ? defaultMilk({ lastMilk, everPumped: !!summary.last["lana.pump"], inStock, namedMilkThisWeek: week.some((e) => e.type_id === "lana.feed" && e.payload.method === "Bottle" && typeof e.payload.milk === "string" && e.payload.milk.trim() !== "") }) : null;
  const { data: statsData } = showPump && summary && summary.ok ? await supabase.rpc("care_daily_stats", { p_subject_id: summary.subject.id, p_from: addDays(today, -7), p_to: today }) : { data: null };
  // Badges (migration 5900): anything the log has just earned, shown once; and for whoever pumps,
  // a nudge to keep a run going when nothing more pressing is waiting. The nudge is a
  // stored-milk notice: a run needs a pump today or yesterday, so with no day it shows as before.
  const { data: achData } = summary && summary.ok && can(me, "lana", "view") ? await supabase.rpc("achievements_check") : { data: null };
  const ach = achData as { ok?: boolean; new?: FreshBadge[]; numbers?: BadgeNumbers; cheers?: Cheer[]; nights?: { member_id: string; cheered: boolean }[] } | null;
  const fresh = ach?.ok ? (ach.new ?? []) : [];
  // Cheers and shared nights (migration 7000; DESIGN.md, "Cheers and shared nights"). Both ride
  // in the call above, and the night itself is read from the week Home already holds.
  const cheers = ach?.ok ? (ach.cheers ?? []) : [];
  const parent = me.role.id === "admin" && !me.preview;
  const childMorning = summary && summary.ok ? nightWindow(summary.subject.settings).to : null;
  const lastNight = nightOf(today, tz, childMorning);
  // The morning line, for the other parent: a member who shares her nights was up twice or
  // more. From the night's end until noon; gone once he has cheered it or taken the child.
  let morning: { sharer: { id: string; name: string }; times: number; longestMin: number } | null = null;
  if (parent && ach?.ok && household.ok && summary && summary.ok && now.getTime() >= lastNight.to && hour < 12 && !(summary.custody?.member_id === me.member.id && Date.parse(summary.custody.since) >= lastNight.to)) {
    const open = (ach.nights ?? []).filter((n) => !n.cheered).map((n) => n.member_id);
    // Never two lines: whoever breastfeeds first, then the home's own order.
    const sharers = household.members.filter((m) => open.includes(m.id)).sort((a, b) => Number(!!b.breastfeeds) - Number(!!a.breastfeeds));
    for (const m of sharers) {
      const night = memberNight(week, m.id, lastNight);
      if (night) {
        morning = { sharer: { id: m.id, name: m.name }, ...night };
        break;
      }
    }
  }
  // The question, on her own Home, until she answers it: only where there is another parent to
  // tell, in the daytime, and only once a real night of hers would give a line to show her.
  let ask: { names: string; sample: { name: string; times: number; longestMin: number } } | null = null;
  if (parent && me.member.night_share == null && household.ok && summary && summary.ok && hour >= 8 && hour < 20) {
    const others = household.members.filter((m) => m.id !== me.member.id && m.role_id === "admin");
    const got = others.length ? latestNight(week, me.member.id, today, tz, now.getTime(), childMorning) : null;
    if (got) ask = { names: andList(others.map((m) => m.name)), sample: { name: nightName(got.win.day, today), ...got.night } };
  }
  const keep = me.member.breastfeeds && ach?.numbers && plan.milkNotices ? runNudge(ach.numbers) : null;
  const pumpDays = (((statsData as { ok?: boolean; days?: PumpDay[] } | null)?.days ?? []) as PumpDay[]).map((d) => ({ day: d.day, pump_ml: Number(d.pump_ml) || 0 }));
  // Since yesterday evening, like the Milk screen's goal: a night pump counts for the day it feeds.
  const evening = new Date(Date.parse(dayRange(addDays(today, -1), tz).from) + 18 * 3_600_000).toISOString();
  const pumps = week.filter((e) => e.type_id === "lana.pump" && e.occurred_at >= evening);
  const meals = week.filter((e) => e.type_id === "lana.meal");
  const dayEnd = Date.parse(dayRange(today, tz).to);
  // The guide's most pressing tip (DESIGN.md, rule 3): a red one right after an overdue vaccine, a yellow one after "feed due".
  const tip = summary && summary.ok ? tipsFor(week, summary.subject.birth_date, now.getTime(), { timezone: tz, feedGapMin: summary.types.find((t) => t.id === "lana.feed")?.due_after_min ?? undefined, name: summary.subject.name, sex: child(me)?.sex ?? null }).find((t) => t.level !== "info") ?? null : null;
  const tipNotice = tip ? (
    <Link prefetch={false} href={tip.topic === "sleep" ? "/baby/sleep" : tip.topic === "feeds" ? "/baby/feed" : `/baby/when-to-call/${tip.topic}`} className={`notice ${tip.level === "red" ? "notice-danger" : tip.topic === "sleep" ? "tint-sleep" : tip.topic === "feeds" ? "tint-feed" : tip.topic === "nappies" || tip.topic === "poo" ? "tint-diaper" : "notice-warn"} flex items-center gap-2 no-underline`}>
      <span className="flex-1 font-semibold">{tip.title}</span> <Icon name="forward" size={18} />
    </Link>
  ) : null;

  // The alerts of this hour, in order. Each is one line or a small card; they are never folded.
  // Stored milk only where milk is stored (R7, plan.milkNotices): a toddler's home with nothing
  // in stock and no pump in 14 days gets no fridge notices; a baby's home always has them. The
  // fridge plan needs the clock as well, so a home on a clock that stores no milk gets none.
  // "Since Mama left": a toddler's tiles only for what the family logs (R8, plan.kinds).
  const alerts: Record<string, React.ReactNode> =
    summary && summary.ok
      ? {
          countdown: milkOk && plan.milkNotices ? <BottleCountdown key="c" milk={milkOk} lastFeedAt={lastFeedAt} mamaAway={mamaAway} milkClock={plan.milkClock} timezone={tz} nextAtIso={nextBottle ? new Date(nextBottle.at).toISOString() : null} /> : null,
          thaw: milkOk && plan.milkNotices ? <ThawReminder key="th" milk={milkOk} entries={week} timezone={tz} opts={thawOpts} /> : null,
          plan: milkOk && mamaAway && plan.milkNotices ? <FridgePlan key="fp" milk={milkOk} lastFeedAt={lastFeedAt} backAtIso={atLocal(to)} bottleMl={lastBottleMl} timezone={tz} name={mama?.name ?? "Mama"} milkClock={plan.milkClock} /> : null,
          handover:
            mamaWorks && (part === "away" || part === "evening") && hhm >= from ? (
              <HandoverSince key="h" entries={recent} kinds={plan.kinds} fromIso={atLocal(from)} toIso={part === "away" ? now.toISOString() : atLocal(to)} label={part === "away" ? `Since ${mama?.name ?? "Mama"} left at ${fmtTime(atLocal(from), tz)}` : `While ${mama?.name ?? "Mama"} was at work`} />
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
  const feedDue = summary && summary.ok && plan.milkClock ? summary.last["lana.feed"]?.next_due ?? null : null;
  // The feed and nap reminders show themselves on the phone when their time comes
  // (DueNotice), so Home left open still says so; these flags only size "N more".
  const feeding = !!(summary && summary.ok && summary.ongoing.some((e) => e.type_id === "lana.feed"));
  const feedIsDue = !!feedDue && Date.parse(feedDue) <= now.getTime() && !feeding;
  const hourOf = (iso: string) => {
    const p = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date(iso));
    return Number(p.find((x) => x.type === "hour")?.value ?? 0) + Number(p.find((x) => x.type === "minute")?.value ?? 0) / 60;
  };
  const nap = summary && summary.ok && age != null ? nextNap(week, age, now.getTime(), hourOf, pattern) : null;
  const napWatch = !!nap && !nap.asleepSince && nap.at != null && nap.awakeMin <= (stage?.limits.awakeKnownMin ?? 12 * 60);
  const checks = summary && summary.ok && can(me, "lana", "edit") ? checkEntries(week, { ageDays: age }).length : 0;
  const fridgeLow = !!milkOk && plan.milkNotices && milkOk.fridge_ml < lastBottleMl;
  // "{Name} is one. Look at her day": the day offered at 12, 18, 24 and 36 months, for 30 days,
  // to parents only and never while viewing as someone else. For its first week it sits ahead
  // of "A vaccine is due" (the 12-month visit is due the same weeks, and behind it the line
  // would wait unseen as "+1"); after that behind it, so a vaccine never waits long on a setting.
  const offer =
    summary && summary.ok && me.role.id === "admin" && !me.preview
      ? dayOffer({ settings: summary.subject.settings, birthDate: summary.subject.birth_date, createdAt: summary.subject.created_at ?? null, today, tz, name: summary.subject.name, their: pronouns(child(me)?.sex ?? null).their })
      : null;
  const offerNotice = offer ? (
    <Link prefetch={false} href="/baby/day?offer=1" className="notice flex items-center gap-2 no-underline">
      <span className="flex-1 font-semibold">{offer.words}</span> <Icon name="forward" size={18} />
    </Link>
  ) : null;
  const known = [vaccine?.overdue, !!tip, mamaAway && !!milkOk && plan.milkNotices, feedIsDue, checks > 0, !!offer, vaccine && !vaccine.overdue, fridgeLow, !!keep, !!morning, !!ask].filter(Boolean).length;

  // The Now slot's candidates, in rule 3's order. The slot shows the first that renders
  // anything (.now-queue); "More" beside it lists them all in a sheet (NowMore).
  const nowQueue: React.ReactNode[] = summary && summary.ok ? [
    <div key="n0">
      {vaccine?.overdue && (
        <Link prefetch={false} href="/baby/vaccines" className="notice notice-danger flex items-center gap-2 no-underline">
          <Icon name="syringe" size={20} /> <span className="flex-1 font-semibold">Vaccine overdue</span> <Icon name="forward" size={18} />
        </Link>
      )}
    </div>,
    <div key="n1">{tip?.level === "red" ? tipNotice : null}</div>,
    <div key="n2">{mamaAway ? alerts.countdown : null}</div>,
    <div key="n3">
      {feedDue && !feeding && (
        <DueNotice fromMs={Date.parse(feedDue)} className="notice tint-feed" href="/baby/feed">
          <b>Feed due now</b>
          {lastFeedAt ? ` · last ${fmtWhen(lastFeedAt, tz, now)}` : ""}
        </DueNotice>
      )}
    </div>,
    <div key="n4">{tip?.level === "yellow" ? tipNotice : null}</div>,
    <div key="n5">{order.includes("plan") ? alerts.plan : null}</div>,
    <div key="n6">{order.includes("handover") ? alerts.handover : null}</div>,
    <div key="n7">{order.includes("thaw") ? alerts.thaw : null}</div>,
    <div key="n8">
      {checks > 0 && (
        <Link prefetch={false} href="/baby" className="notice notice-warn flex items-center gap-2 no-underline">
          <span className="flex-1 font-semibold">
            {checks} {checks === 1 ? "entry" : "entries"} to check
          </span>
          <Icon name="forward" size={18} />
        </Link>
      )}
    </div>,
    // The other parent's night: after anything to check, ahead of what can wait all day, because
    // this line ends at noon (as the early offer below argues for itself).
    morning ? (
      <div key="night">
        <NightNotice sharer={morning.sharer} times={morning.times} longestMin={morning.longestMin} nightDay={lastNight.day} subjectId={summary.subject.id} child={summary.subject.name} meId={me.member.id} canTake={can(me, "lana", "add")} holding={summary.custody?.member_id === me.member.id} />
      </div>
    ) : null,
    // The day's offer makes its own place only while it is there, so a home with none has the queue as it was.
    offer?.early ? <div key="offer-early">{offerNotice}</div> : null,
    <div key="n9">
      {vaccine && !vaccine.overdue && (
        <Link prefetch={false} href="/baby/vaccines" className="notice flex items-center gap-2 no-underline tint-meds">
          <Icon name="syringe" size={20} /> <span className="flex-1 font-semibold">A vaccine is due</span> <Icon name="forward" size={18} />
        </Link>
      )}
    </div>,
    offer && !offer.early ? <div key="offer">{offerNotice}</div> : null,
    <div key="n10">
      {milkOk && fridgeLow && (
        <Link prefetch={false} href="/baby/milk" className="notice flex items-center gap-2 no-underline tint-milk">
          <Icon name="droplet" size={20} /> <span className="flex-1 font-semibold">Fridge is low: {milkOk.fridge_ml} ml</span> <Icon name="forward" size={18} />
        </Link>
      )}
    </div>,
    <div key="n11">
      {sitter && (
        <Link prefetch={false} href="/baby/handover" className="notice flex items-center gap-2 no-underline">
          <span className="flex-1 font-semibold">The handover</span> <Icon name="forward" size={18} />
        </Link>
      )}
    </div>,
    // Her own question, asked once: a setting, so it waits behind everything but the nudge.
    ask ? (
      <div key="night-ask">
        <NightAsk names={ask.names} me={me.member.display_name} sample={ask.sample} />
      </div>
    ) : null,
    <div key="n12">
      {keep && (
        <Link prefetch={false} href="/achievements" className="notice tint-pump flex items-center gap-2 no-underline">
          <Icon name="star" size={20} /> <span className="flex-1 font-semibold">{keep}</span> <Icon name="forward" size={18} />
        </Link>
      )}
    </div>,
  ] : [];

  return summary && summary.ok ? (
    <div className="flex flex-col gap-4">
    <div className="screen-fill">
      {/* Keyed by what is new: a badge won while Home is open (a pump logged, the page refreshed) pops too. */}
      <Celebration key={[...cheers.map((c) => c.id), ...fresh.map((f) => f.id)].join(",")} fresh={fresh} cheers={cheers} today={today} timezone={tz} />
      <HomeHeader summary={summary} />
      <HomeState summary={summary} stage={{ toddler: isToddler(age), limits: limitsFor(age) }} timezone={tz} clockIso={now.toISOString()} nap={napWatch && nap?.at != null ? { at: nap.at, isBedtime: !!nap.isBedtime } : null} />
      <TodayStrip summary={summary} entries={week} day={today} timezone={tz} nowIso={now.toISOString()} napExpected={pattern.expected} plan={plan} />
      {/* One thing that needs a look, on one line; the rest wait behind "More" beside it
          (DESIGN.md rule 3), which lists them in a sheet over Home. */}
      <div className="now-line">
        <div className="now-queue">{nowQueue}</div>
        {known > 1 && <NowMore count={known - 1}>{nowQueue}</NowMore>}
      </div>
      <LanaNow subject={summary.subject} types={summary.types} ongoing={summary.ongoing} recent={recent} timezone={tz} clockIso={now.toISOString()} defaultMilk={firstMilk} lastFeedMethod={(summary.last["lana.feed"]?.payload?.method as string | undefined) ?? null} lastPumpAt={summary.last["lana.pump"]?.occurred_at ?? null} tell={can(me, "assistant", "add") && can(me, "lana", "add") ? <TellBar quick={quickContextOf(summary, me)} /> : null} />
      {/* The bar's ＋ opens the log sheet here, rather than taking the person to the child's page. */}
      <LogMenu subjectId={summary.subject.id} types={summary.types} timezone={tz} day={today} isToday entries={week} todayEntries={recent.filter((e) => Date.parse(e.occurred_at) >= dayStart)} feedIntervalMin={stage ? feedGapFor(stage, summary.types.find((t) => t.id === "lana.feed")?.due_after_min) : 180} milkClock={plan.milkClock} solids={stage?.solids ?? false} plan={plan} />
    </div>
    <section id="today" aria-label="Today in detail" className="flex scroll-mt-4 flex-col gap-4">
      <SleepDay entries={week} day={today} timezone={tz} nowIso={now.toISOString()} night={nightWindow(summary.subject.settings)} usualNaps={plan.usualNaps ?? stage?.naps ?? null} sums="short" since={false} href="/baby/sleep" />
      <FeedDay summary={summary} entries={week} dayStartMs={dayStart} dayEndMs={dayEnd} timezone={tz} nowIso={now.toISOString()} today={today} href="/baby/feed" plan={plan} usual={false} />
      {showFood && stage && <FoodDay meals={meals} dayStartMs={dayStart} dayEndMs={dayEnd} stage={stage} timezone={tz} />}
      {showPump && <PumpDashboard pumps={pumps} milk={milkOk} target={me.household.milk_target_ml ?? 400} days={pumpDays} today={today} hourOfDay={hour} />}
    </section>
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
