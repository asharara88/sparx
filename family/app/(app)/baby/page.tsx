import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { awayParentOn } from "@/lib/handover";
import type { ActivitiesData, BagItem, DailyStats, EntryRow, HomeSummary, HouseholdToday, Me, MedicinesData, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { childPronouns, possessive, type Pronouns } from "@/lib/names";
import { addDays, dayRange, describePayload, fmtDuration, fmtTime, minutesBetween, todayYmd } from "@/lib/time";
import { ageDays, ageLabel } from "@/lib/norms";
import { AgeCheck } from "@/components/AgeCheck";
import { Avatar } from "@/components/Avatar";
import { DayStrip } from "@/components/DayStrip";
import { HandoverPanel } from "@/components/HandoverPanel";
import { Icon, type IconName } from "@/components/Icon";
import { LanaTabs, type LanaTab } from "@/components/LanaTabs";
import { PatternBars } from "@/components/PatternBars";
import { LanaForecast } from "@/components/LanaForecast";
import { Medicines } from "@/components/Medicines";
import { SleepCoach } from "@/components/SleepCoach";
import { PlanCard } from "@/components/PlanCard";
import { WeekCard } from "@/components/WeekCard";
import { PhaseCard } from "@/components/PhaseCard";
import { Activities } from "@/components/Activities";
import { EntryChecks } from "@/components/EntryChecks";
import { NextNap } from "@/components/NextNap";
import { MoodTap } from "@/components/MoodTap";
import { Backfill } from "@/components/Backfill";
import { MoodPattern } from "@/components/MoodPattern";
import type { CoachPlanData } from "@/lib/types";
import { WORK_FROM, WORK_TO, hhmm } from "@/lib/household";
import { Fold, type Tint } from "@/components/Fold";
import { tintFor } from "@/lib/tints";

export const dynamic = "force-dynamic";

/** The child's own section: Today, Patterns, Week, Handover, Ask, and the way to everything else about them. */
export default async function LanaPage({ searchParams }: { searchParams: Promise<{ d?: string; tab?: string }> }) {
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  if (!can(me, "lana", "view")) redirect("/");
  const tz = me.household.timezone;
  const today = todayYmd(tz);
  const sp = await searchParams;
  const tab: LanaTab = (["today", "patterns", "week", "handover", "ask"] as const).includes(sp.tab as LanaTab) ? (sp.tab as LanaTab) : "today";
  const day = sp.d && /^\d{4}-\d{2}-\d{2}$/.test(sp.d) ? sp.d : today;

  const { data: sumData } = await supabase.rpc("home_summary");
  const summary = sumData as HomeSummary | RpcError;
  if (!summary.ok) redirect("/");
  const s = summary.subject;
  const pr = childPronouns(me);
  const age = s.birth_date ? `${ageLabel(ageDays(s.birth_date, today))} old` : "";
  const photo = (s.profile?.photo_path as string | undefined) ?? null;

  // Everything about the child, one tile each, in the colour of its feature.
  const tiles: { href: string; icon: IconName; label: string; tint: Tint }[] = [
    { href: "/baby/milk", icon: "droplet", label: "Milk", tint: "milk" },
    { href: "/baby/vaccines", icon: "syringe", label: "Vaccines", tint: "meds" },
    { href: "/baby/medicine", icon: "clock", label: "Medicine", tint: "meds" },
    { href: "/baby/doctor", icon: "phone", label: "Doctor", tint: "feed" },
    { href: "/baby/milestones", icon: "star", label: "Firsts", tint: "sleep" },
    { href: "/baby/activities", icon: "sparkles", label: "Play", tint: "pump" },
    { href: "/baby/trends", icon: "trend", label: "Growth", tint: "house" },
    { href: "/baby/weeks", icon: "calendar", label: "Weeks", tint: "cal" },
    { href: "/baby/story", icon: "note", label: "Story", tint: "notes" },
    { href: "/baby/emergency", icon: "bell", label: "Emergency", tint: "danger" },
    { href: "/baby/when-to-call", icon: "clipboard", label: "When to call", tint: "diaper" },
    { href: "/baby/export", icon: "printer", label: "For the doctor", tint: "guide" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <header className="page-header page-header-large flex items-center gap-3">
        <Avatar name={s.name} path={photo} size={64} />
        <div className="min-w-0 flex-1">
          <h1 className="page-title">{s.name}</h1>
          <p className="muted">{age}</p>
        </div>
      </header>
      <LanaTabs active={tab} day={day} />
      {tab === "today" && <TodayTab supabase={supabase} me={me} summary={summary} day={day} today={today} tz={tz} pr={pr} />}
      {tab === "patterns" && <PatternsTab supabase={supabase} summary={summary} today={today} tz={tz} pr={pr} />}
      {tab === "week" && <WeekTab supabase={supabase} summary={summary} today={today} />}
      {tab === "handover" && <HandoverTab supabase={supabase} summary={summary} />}
      {tab === "ask" && <AskTab me={me} name={s.name} pr={pr} />}
      <h2 className="section-title mt-2">More about {s.name}</h2>
      <nav aria-label={`More about ${s.name}`} className="grid grid-cols-4 gap-2">
        {tiles.map((t) => (
          <Link key={t.href} href={t.href} className={`tile tile-sm tint-${t.tint}`}>
            <span className="icon-disc" style={{ width: 36, height: 36 }}>
              <Icon name={t.icon} size={20} />
            </span>
            <span className="w-full text-xs font-bold leading-tight">{t.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

type SB = Awaited<ReturnType<typeof createClient>>;

async function TodayTab({ supabase, me, summary, day, today, tz, pr }: { supabase: SB; me: Me; summary: HomeSummary; day: string; today: string; tz: string; pr: Pronouns }) {
  const { from, to } = dayRange(day, tz);
  const isToday = day === today;
  const [{ data: listData }, { data: stripData }, { data: statsData }, { data: medData }, { data: weekData }, { data: hhData }] = await Promise.all([
    supabase.rpc("care_entries_list", { p_subject_id: summary.subject.id, p_from: from, p_to: to }),
    supabase.rpc("care_entries_list", { p_subject_id: summary.subject.id, p_from: new Date(new Date(from).getTime() - 12 * 3600 * 1000).toISOString(), p_to: to }),
    supabase.rpc("care_daily_stats", { p_subject_id: summary.subject.id, p_from: day, p_to: day }),
    isToday ? supabase.rpc("medicines_list", { p_subject_id: summary.subject.id }) : Promise.resolve({ data: null }),
    isToday ? supabase.rpc("care_entries_list", { p_subject_id: summary.subject.id, p_from: new Date(Date.now() - 7 * 86_400_000).toISOString(), p_to: new Date(Date.now() + 3_600_000).toISOString() }) : Promise.resolve({ data: null }),
    isToday ? supabase.rpc("household_today") : Promise.resolve({ data: null }),
  ]);
  const { data: planData } = isToday ? await supabase.rpc("coach_plan_active", { p_subject_id: summary.subject.id }) : { data: null };
  const plan = (planData as CoachPlanData | null)?.ok ? (planData as CoachPlanData).plan : null;
  const { data: actData } = isToday ? await supabase.rpc("activities_list", { p_subject_id: summary.subject.id }) : { data: null };
  const acts = (actData as ActivitiesData | RpcError | null)?.ok ? (actData as ActivitiesData).items : [];
  const meds = medData as MedicinesData | RpcError | null;
  const week = ((weekData as { entries?: EntryRow[] } | null)?.entries ?? []) as EntryRow[];
  const hh = hhData as HouseholdToday | RpcError | null;
  // Was a parent away at this instant? Each day has its own away parent, so two parents
  // who work on different days each get their day's hours.
  const members = hh && hh.ok ? hh.members : [];
  const away = (at: number) => {
    const d = new Date(at);
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(d);
    const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.find((p) => p.type === "weekday")?.value ?? "");
    const hm = Number(parts.find((p) => p.type === "hour")?.value ?? 0) * 100 + Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    const who = awayParentOn(members, wd);
    return !!who && who.work_days.includes(wd) && hm >= hhmm(who.work_from, WORK_FROM) && hm <= hhmm(who.work_to, WORK_TO);
  };
  const feedInterval = summary.types.find((t) => t.id === "lana.feed")?.due_after_min ?? 180;
  const entries = ((listData as { entries?: EntryRow[] })?.entries ?? []) as EntryRow[];
  const stripEntries = ((stripData as { entries?: EntryRow[] })?.entries ?? []) as EntryRow[];
  const stats = statsData as DailyStats | RpcError | null;
  const dayStats = stats?.ok ? (stats.days.find((x) => x.day === day) ?? stats.days[0] ?? null) : null;
  const counts = new Map<string, number>();
  let feedMl = 0;
  let sleepMin = 0;
  for (const e of entries) {
    counts.set(e.type_label, (counts.get(e.type_label) ?? 0) + 1);
    if (e.type_id === "lana.feed" && typeof e.payload.amount_ml === "number") feedMl += e.payload.amount_ml;
    if (e.type_id === "lana.sleep" && e.ended_at) sleepMin += minutesBetween(e.occurred_at, e.ended_at);
  }
  const label = day === today ? "Today" : day === addDays(today, -1) ? "Yesterday" : day;
  return (
    <>
      <div className="flex items-center justify-between">
        <Link href={`/baby?tab=today&d=${addDays(day, -1)}`} className="icon-btn" aria-label="Previous day">
          <Icon name="back" size={22} />
        </Link>
        <p className="font-semibold">{label}</p>
        <Link href={`/baby?tab=today&d=${addDays(day, 1)}`} className="icon-btn" aria-label="Next day" aria-disabled={day >= today} style={day >= today ? { visibility: "hidden" } : undefined}>
          <Icon name="forward" size={22} />
        </Link>
      </div>
      <DayStrip entries={stripEntries} day={day} timezone={tz} nowIso={day === today ? new Date().toISOString() : undefined} />
      <div className="card">
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          {[...counts.entries()].map(([k, v]) => (
            <span key={k}>
              <b>{v}</b> {k.toLowerCase()}
              {v === 1 ? "" : "s"}
            </span>
          ))}
          {feedMl > 0 && (
            <span>
              <b>{feedMl} ml</b> bottle
            </span>
          )}
          {sleepMin > 0 && (
            <span>
              <b>{fmtDuration(sleepMin)}</b> sleep
            </span>
          )}
          {entries.length === 0 && <span className="muted">Nothing logged on this day.</span>}
        </p>
      </div>
      {isToday && can(me, "lana", "edit") && <EntryChecks entries={week} timezone={tz} canDelete={can(me, "lana", "delete")} />}
      {isToday && summary.subject.birth_date && <NextNap entries={week} ageDays={ageDays(summary.subject.birth_date, today)} timezone={tz} />}
      {isToday && <MoodTap subjectId={summary.subject.id} today={entries} timezone={tz} />}
      {isToday && (
        <Fold title="Coming up" icon="clock" tint="sleep" hint="next 12 hours">
          <LanaForecast bare entries={week} timezone={tz} away={away} feedIntervalMin={feedInterval} hours={12} />
          <PlanCard plan={plan} />
        </Fold>
      )}
      {isToday && meds && meds.ok && meds.items.some((m) => m.last_at) && (
        <Fold title="Medicine" icon="clock" tint="meds" hint={`${meds.items.filter((m) => m.last_at).length} in use`}>
          <Medicines subjectId={summary.subject.id} items={meds.items} timezone={tz} compact />
        </Fold>
      )}
      {isToday && acts.length > 0 && (
        <Fold title="Play" icon="sparkles" tint="pump" hint={`${pr.their} age now`}>
          <Activities subjectId={summary.subject.id} items={acts} compact />
        </Fold>
      )}
      {dayStats && (
        <Fold title={day === today ? `Today against ${pr.their} age` : `Against ${pr.their} age`} icon="trend" tint="guide" hint={day === today ? "so far" : undefined}>
          <AgeCheck totals={dayStats} birthDate={summary.subject.birth_date} day={day} complete={day < today} title={day === today ? `Today against ${pr.their} age` : `Against ${pr.their} age`} subtitle={day === today ? "Counts so far. Nothing is flagged until the day is over." : undefined} />
        </Fold>
      )}
      {isToday && can(me, "assistant", "view") && (
        <Fold title="The helper's week" icon="sparkles" tint="guide">
          <WeekCard name={summary.subject.name} />
        </Fold>
      )}
      <Backfill subjectId={summary.subject.id} types={summary.types} timezone={tz} day={day} entries={isToday ? week : []} feedIntervalMin={feedInterval} />
      <ul className="flex flex-col gap-2">
        {entries.map((e) => (
          <li key={e.id}>
            <Link href={`/baby/entry/${e.id}`} className="card flex items-center gap-3 no-underline">
              <span aria-hidden className="text-3xl">
                {e.icon}
              </span>
              <span className="flex-1">
                <span className="block text-lg font-semibold">
                  {fmtTime(e.occurred_at, tz)}
                  {e.ended_at ? ` – ${fmtTime(e.ended_at, tz)}` : e.type_id === "lana.sleep" ? " – still sleeping" : ""}
                  {"  "}
                  <span className="font-normal">{e.type_label}</span>
                </span>
                <span className="muted block">{[describePayload(e.payload), e.note].filter(Boolean).join(" · ")}</span>
                <span className="muted block text-sm">{e.attributed_name ?? e.logged_by_name}</span>
              </span>
              <span aria-hidden className="muted">
                ›
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-2 gap-3">
        {summary.types.map((t) => (
          <Link key={t.id} href={`/baby/log/${t.key}`} className={`action tint-${tintFor(t.key)} justify-center`} style={{ minHeight: 64 }}>
            <span aria-hidden className="text-2xl">
              {t.icon}
            </span>
            <span className="action-label text-lg">{t.label}</span>
          </Link>
        ))}
      </div>
    </>
  );
}

async function PatternsTab({ supabase, summary, today, tz, pr }: { supabase: SB; summary: HomeSummary; today: string; tz: string; pr: Pronouns }) {
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
  const [{ data: listData }, { data: statsData }] = await Promise.all([
    supabase.rpc("care_entries_list", { p_subject_id: summary.subject.id, p_from: dayRange(days[0], tz).from, p_to: dayRange(today, tz).to }),
    supabase.rpc("care_daily_stats", { p_subject_id: summary.subject.id, p_from: addDays(today, -7), p_to: addDays(today, -1) }),
  ]);
  const entries = ((listData as { entries?: EntryRow[] } | null)?.entries ?? []) as EntryRow[];
  const stats = statsData as DailyStats | RpcError | null;
  const week = stats?.ok ? stats.days : [];
  const mean = (k: "breast_count" | "bottle_count" | "bottle_ml" | "diapers_wet" | "diapers_dirty" | "sleep_min" | "night_sleep_min") => (week.length ? week.reduce((a, d) => a + Number(d[k] ?? 0), 0) / week.length : 0);
  return (
    <>
      <PatternBars entries={entries} days={days} timezone={tz} today={today} />
      {week.length > 0 && (
        <AgeCheck
          totals={{ breast_count: mean("breast_count"), bottle_count: mean("bottle_count"), bottle_ml: mean("bottle_ml"), diapers_wet: mean("diapers_wet"), diapers_dirty: mean("diapers_dirty"), sleep_min: mean("sleep_min"), night_sleep_min: mean("night_sleep_min") }}
          birthDate={summary.subject.birth_date}
          day={week[week.length - 1].day}
          complete
          title={`This week against ${pr.their} age`}
          subtitle="Average per day over the last 7 full days."
        />
      )}
      {summary.subject.birth_date && <PhaseCard ageDays={ageDays(summary.subject.birth_date, today)} name={summary.subject.name} />}
      <SleepCoach entries={entries} ageDays={summary.subject.birth_date ? ageDays(summary.subject.birth_date, today) : 120} timezone={tz} />
      <MoodPattern entries={entries} days={days} stats={stats?.ok ? stats.days : []} timezone={tz} />
      <Link href="/baby/trends" className="btn">
        <Icon name="trend" size={18} /> Trends and growth
      </Link>
    </>
  );
}

async function WeekTab({ supabase, summary, today }: { supabase: SB; summary: HomeSummary; today: string }) {
  const { data } = await supabase.rpc("care_daily_stats", { p_subject_id: summary.subject.id, p_from: addDays(today, -6), p_to: today });
  const stats = data as DailyStats | RpcError | null;
  const days = stats?.ok ? [...stats.days].reverse() : [];
  const Stat = ({ n, l, tone }: { n: string; l: string; tone: string }) => (
    <div className={`rounded-xl p-2 text-center ${tone}`}>
      <p className="text-xl font-bold">{n}</p>
      <p className="text-sm">{l}</p>
    </div>
  );
  return (
    <ul className="flex flex-col gap-3">
      {days.map((d) => (
        <li key={d.day} className="card">
          <p className="text-lg font-bold">
            {d.day === today ? "Today" : d.day === addDays(today, -1) ? "Yesterday" : new Date(`${d.day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" })}
          </p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <Stat n={`${d.breast_count + d.bottle_count}`} l={d.bottle_ml ? `feeds · ${d.bottle_ml} ml` : "feeds"} tone="bg-[var(--accent-soft)]" />
            <Stat n={fmtDuration(d.sleep_min)} l={d.night_sleep_min ? `sleep · night ${fmtDuration(d.night_sleep_min)}` : "sleep"} tone="bg-[var(--info-soft)]" />
            <Stat n={`${d.diapers}`} l={`diapers · ${d.diapers_wet} wet`} tone="bg-[var(--ok-soft)]" />
          </div>
        </li>
      ))}
      {days.length === 0 && <li className="card muted">Nothing logged this week.</li>}
    </ul>
  );
}

async function HandoverTab({ supabase, summary }: { supabase: SB; summary: HomeSummary }) {
  const { data: bagData } = await supabase.from("bag_items").select("*").order("sort");
  return <HandoverPanel summary={summary} bag={((bagData as BagItem[] | null) ?? []) as BagItem[]} />;
}

function AskTab({ me, name, pr }: { me: Me; name: string; pr: Pronouns }) {
  if (!can(me, "assistant", "view")) return <p className="card muted">The assistant is not switched on for your role.</p>;
  const prompts = [`How was ${possessive(name)} night?`, `Is ${name} sleeping enough for ${pr.their} age?`, "When was the last dirty diaper?", "What is due at the clinic next?"];
  return (
    <section className="card flex flex-col gap-3">
      <p className="text-lg">Ask anything about {possessive(name)} feeds, sleep, diapers, milk or vaccines. The helper reads {pr.their} log and the guidance in this app.</p>
      <Link href="/ask" className="btn btn-primary btn-lg">
        <Icon name="sparkles" size={20} /> Open Ask
      </Link>
      <div className="flex flex-wrap gap-2">
        {prompts.map((p) => (
          <Link key={p} href={`/ask?from=lana&q=${encodeURIComponent(p)}`} className="chip">
            {p}
          </Link>
        ))}
      </div>
      <p className="muted text-xs">Not medical advice. For health worries, call {pr.their} paediatrician.</p>
    </section>
  );
}
