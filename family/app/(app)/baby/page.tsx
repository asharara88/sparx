import Link from "next/link";
import { feedGapFor, stageFor } from "@/lib/stage";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { awayParentOn } from "@/lib/handover";
import type { DailyStats, EntryRow, HomeSummary, HouseholdToday, Me, RpcError, Suggestion } from "@/lib/types";
import { can } from "@/lib/types";
import { childPronouns, type Pronouns } from "@/lib/names";
import { addDays, dayRange, fmtDuration, todayYmd } from "@/lib/time";
import { ageDays, ageLabel } from "@/lib/norms";
import { AgeCheck } from "@/components/AgeCheck";
import { LanaGuide } from "@/components/LanaGuide";
import { AvatarUpload } from "@/components/AvatarUpload";
import { SuggestionCards } from "@/components/SuggestionCards";
import { Avatar } from "@/components/Avatar";
import { DayStrip } from "@/components/DayStrip";
import { SleepDay } from "@/components/SleepDay";
import { nightWindow } from "@/lib/night";
import { Icon, type IconName } from "@/components/Icon";
import { LanaTabs, type LanaTab } from "@/components/LanaTabs";
import { LogMenu } from "@/components/LogMenu";
import { EntryList } from "@/components/EntryList";
import { WeekColumns } from "@/components/WeekColumns";
import { LanaForecast } from "@/components/LanaForecast";
import { SleepCoach } from "@/components/SleepCoach";
import { PlanCard } from "@/components/PlanCard";
import { WeekCard } from "@/components/WeekCard";
import { BriefCard } from "@/components/BriefCard";
import { PhaseCard } from "@/components/PhaseCard";
import { EntryChecks } from "@/components/EntryChecks";
import { MoodPattern } from "@/components/MoodPattern";
import type { CoachPlanData } from "@/lib/types";
import { WORK_FROM, WORK_TO, hhmm } from "@/lib/household";
import { checkEntries } from "@/lib/entry-checks";
import { Fold } from "@/components/Fold";
import { meOnce } from "@/lib/server/me";

export const dynamic = "force-dynamic";

/**
 * The child's page (DESIGN.md, "The child's page"): Today / Week / About her. Today is the
 * day's totals and entries with "+ Log" at the bottom; Week is how the days go; About her
 * is everything else about the child, as one list.
 */
export default async function LanaPage({ searchParams }: { searchParams: Promise<{ d?: string; tab?: string }> }) {
  const supabase = await createClient();
  const { data: meData } = await meOnce();
  const me = meData as Me;
  if (!can(me, "lana", "view")) redirect("/");
  const tz = me.household.timezone;
  const today = todayYmd(tz);
  const sp = await searchParams;
  // Old links: Patterns joined Week, Handover has its own screen, Ask is the Chat tab's helper.
  if (sp.tab === "handover") redirect("/baby/handover");
  if (sp.tab === "ask") redirect("/ask?from=child");
  const tab: LanaTab = sp.tab === "patterns" ? "week" : sp.tab === "week" || sp.tab === "about" ? sp.tab : "today";
  const day = sp.d && /^\d{4}-\d{2}-\d{2}$/.test(sp.d) && sp.d <= today ? sp.d : today;

  const { data: sumData } = await supabase.rpc("home_summary");
  const summary = sumData as HomeSummary | RpcError;
  if (!summary.ok) redirect("/");
  const s = summary.subject;
  const pr = childPronouns(me);
  const age = s.birth_date ? `${ageLabel(ageDays(s.birth_date, today))} old` : "";
  const photo = (s.profile?.photo_path as string | undefined) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <header className="page-header page-header-large flex items-center gap-3">
        {can(me, "lana", "edit") ? <AvatarUpload name={s.name} path={photo} subject={{ id: s.id, profile: s.profile }} size={56} /> : <Avatar name={s.name} path={photo} size={56} />}
        <div className="min-w-0 flex-1">
          <h1 className="page-title">{s.name}</h1>
          <p className="muted">{age}</p>
        </div>
      </header>
      <LanaTabs active={tab} day={day} them={pr.them} />
      {tab === "today" && <TodayTab supabase={supabase} me={me} summary={summary} day={day} today={today} tz={tz} />}
      {tab === "week" && <WeekTab supabase={supabase} me={me} summary={summary} today={today} tz={tz} pr={pr} />}
      {tab === "about" && <AboutTab me={me} summary={summary} today={today} />}
    </div>
  );
}

type SB = Awaited<ReturnType<typeof createClient>>;

async function TodayTab({ supabase, me, summary, day, today, tz }: { supabase: SB; me: Me; summary: HomeSummary; day: string; today: string; tz: string }) {
  const { from, to } = dayRange(day, tz);
  const isToday = day === today;
  const [{ data: stripData }, { data: weekData }, { data: sugData }] = await Promise.all([
    // From 12 hours before the day, so a sleep that began last night counts towards it.
    supabase.rpc("care_entries_list", { p_subject_id: summary.subject.id, p_from: new Date(new Date(from).getTime() - 12 * 3600 * 1000).toISOString(), p_to: to }),
    isToday ? supabase.rpc("care_entries_list", { p_subject_id: summary.subject.id, p_from: new Date(Date.now() - 7 * 86_400_000).toISOString(), p_to: new Date(Date.now() + 3_600_000).toISOString() }) : Promise.resolve({ data: null }),
    isToday ? supabase.rpc("suggestions_refresh") : Promise.resolve({ data: null }),
  ]);
  const week = ((weekData as { entries?: EntryRow[] } | null)?.entries ?? []) as EntryRow[];
  const feedInterval = feedGapFor(stageFor(summary.subject.birth_date, Date.now(), tz), summary.types.find((t) => t.id === "lana.feed")?.due_after_min);
  const stripEntries = ((stripData as { entries?: EntryRow[] })?.entries ?? []) as EntryRow[];
  const [fromMs, toMs] = [Date.parse(from), Date.parse(to)];
  const entries = stripEntries.filter((e) => Date.parse(e.occurred_at) >= fromMs && Date.parse(e.occurred_at) < toMs).sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
  const checks = isToday ? checkEntries(week).length : 0;
  const suggestions = (((sugData as { suggestions?: Suggestion[] } | null)?.suggestions ?? []) as Suggestion[]).filter((s) => s.kind === "due" || s.kind === "plan");
  // The date, not a second "Today" under the Today tab.
  const label = day === addDays(today, -1) ? "Yesterday" : new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
  return (
    <>
      <div className="flex items-center justify-between">
        <Link prefetch={false} href={`/baby?tab=today&d=${addDays(day, -1)}`} className="icon-btn" aria-label="Previous day">
          <Icon name="back" size={22} />
        </Link>
        <p className="font-semibold">{label}</p>
        <Link prefetch={false} href={`/baby?tab=today&d=${addDays(day, 1)}`} className="icon-btn" aria-label="Next day" aria-disabled={isToday} style={isToday ? { visibility: "hidden" } : undefined}>
          <Icon name="forward" size={22} />
        </Link>
      </div>
      <DayStrip entries={stripEntries} day={day} timezone={tz} nowIso={isToday ? new Date().toISOString() : undefined} list={false} />
      <SleepDay entries={stripEntries} day={day} timezone={tz} nowIso={isToday ? new Date().toISOString() : undefined} night={nightWindow(summary.subject.settings)} usualNaps={stageFor(summary.subject.birth_date, Date.now(), tz).naps} href="/baby/sleep" />
      {checks > 0 && can(me, "lana", "edit") && (
        <Fold title="To check" icon="clipboard" tint="meds" hint={`${checks}`}>
          <EntryChecks entries={week} timezone={tz} canDelete={can(me, "lana", "delete")} />
        </Fold>
      )}
      {isToday && <LanaGuide fold entries={week} birthDate={summary.subject.birth_date} timezone={tz} feedGapMin={feedInterval} />}
      {/* What the data suggests doing (a dose due, a plan for the calendar): useful, not now, so a fold. */}
      {isToday && suggestions.length > 0 && (
        <Fold title="Suggested" icon="calendar" tint="cal" hint={`${suggestions.length}`}>
          <SuggestionCards suggestions={suggestions} title={null} />
        </Fold>
      )}
      {entries.length === 0 ? (
        <p className="muted px-1">Nothing logged on this day.</p>
      ) : (
        <EntryList entries={entries} types={summary.types} timezone={tz} canEdit={can(me, "lana", "edit")} canDelete={can(me, "lana", "delete")} />
      )}
      <LogMenu subjectId={summary.subject.id} types={summary.types} timezone={tz} day={day} isToday={isToday} entries={isToday ? week : []} todayEntries={isToday ? entries : []} feedIntervalMin={feedInterval} solids={stageFor(summary.subject.birth_date, Date.now(), tz).solids} />
    </>
  );
}

async function WeekTab({ supabase, me, summary, today, tz, pr }: { supabase: SB; me: Me; summary: HomeSummary; today: string; tz: string; pr: Pronouns }) {
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
  const [{ data: listData }, { data: statsData }, { data: hhData }, { data: planData }] = await Promise.all([
    supabase.rpc("care_entries_list", { p_subject_id: summary.subject.id, p_from: dayRange(days[0], tz).from, p_to: new Date(Date.now() + 3_600_000).toISOString() }),
    supabase.rpc("care_daily_stats", { p_subject_id: summary.subject.id, p_from: addDays(today, -7), p_to: today }),
    supabase.rpc("household_today"),
    supabase.rpc("coach_plan_active", { p_subject_id: summary.subject.id }),
  ]);
  const entries = ((listData as { entries?: EntryRow[] } | null)?.entries ?? []) as EntryRow[];
  const stats = statsData as DailyStats | RpcError | null;
  const all = stats?.ok ? stats.days : [];
  const full = all.filter((d) => d.day < today);
  const weekAgo = Date.now() - 7 * 86_400_000;
  const lastWeek = entries.filter((e) => Date.parse(e.occurred_at) >= weekAgo);
  const plan = (planData as CoachPlanData | null)?.ok ? (planData as CoachPlanData).plan : null;
  const feedInterval = feedGapFor(stageFor(summary.subject.birth_date, Date.now(), tz), summary.types.find((t) => t.id === "lana.feed")?.due_after_min);
  const mean = (k: "breast_count" | "bottle_count" | "bottle_ml" | "diapers_wet" | "diapers_dirty" | "sleep_min" | "night_sleep_min") => (full.length ? full.reduce((a, d) => a + Number(d[k] ?? 0), 0) / full.length : 0);
  // Was a parent away at this instant? Each day has its own away parent, so two parents
  // who work on different days each get their day's hours.
  const hh = hhData as HouseholdToday | RpcError | null;
  const members = hh && hh.ok ? hh.members : [];
  const away = (at: number) => {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date(at));
    const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.find((p) => p.type === "weekday")?.value ?? "");
    const hm = Number(parts.find((p) => p.type === "hour")?.value ?? 0) * 100 + Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    const who = awayParentOn(members, wd);
    return !!who && who.work_days.includes(wd) && hm >= hhmm(who.work_from, WORK_FROM) && hm <= hhmm(who.work_to, WORK_TO);
  };
  const dayName = (d: string) => (d === today ? "Today" : d === addDays(today, -1) ? "Yesterday" : new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" }));
  return (
    <>
      <WeekColumns entries={entries} days={days.slice(-7)} prevDays={days.slice(0, 7)} timezone={tz} today={today} />
      {full.length > 0 && (
        <Fold title={`Against ${pr.their} age`} icon="trend" hint="a day this week">
          <AgeCheck
            bare
            totals={{ breast_count: mean("breast_count"), bottle_count: mean("bottle_count"), bottle_ml: mean("bottle_ml"), diapers_wet: mean("diapers_wet"), diapers_dirty: mean("diapers_dirty"), sleep_min: mean("sleep_min"), night_sleep_min: mean("night_sleep_min") }}
            birthDate={summary.subject.birth_date}
            day={full[full.length - 1].day}
            complete
            title={`This week against ${pr.their} age`}
            subtitle="A day's average over the last 7 full days."
          />
        </Fold>
      )}
      <Fold title="Coming up" icon="clock" tint="cal" hint="next 12 hours">
        <LanaForecast bare entries={lastWeek} timezone={tz} away={away} feedIntervalMin={feedInterval} hours={12} />
        <PlanCard plan={plan} />
      </Fold>
      <Fold title="Sleep rhythm" icon="moon" tint="sleep" hint="naps and bedtime">
        <SleepCoach bare entries={entries} ageDays={summary.subject.birth_date ? ageDays(summary.subject.birth_date, today) : 120} timezone={tz} />
      </Fold>
      <MoodPattern entries={entries} days={days} stats={all} timezone={tz} />
      {all.length > 0 && (
        <Fold title="Day by day" icon="calendar" tint="cal" hint="last 7 days">
          <ul className="flex flex-col">
            {[...all].reverse().slice(0, 7).map((d) => (
              <li key={d.day} className="row">
                <span className="w-24 shrink-0 font-semibold">{dayName(d.day)}</span>
                <span className="muted min-w-0 flex-1 text-sm">
                  {d.breast_count + d.bottle_count} feeds{d.bottle_ml ? `, ${d.bottle_ml} ml` : ""} · {fmtDuration(d.sleep_min)} sleep · {d.diapers} diapers
                </span>
              </li>
            ))}
          </ul>
        </Fold>
      )}
      {can(me, "assistant", "view") && (
        <Fold title="The helper" icon="sparkles" tint="guide" hint="brief and week">
          <BriefCard hour={Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(new Date()))} />
          <WeekCard name={summary.subject.name} />
        </Fold>
      )}
    </>
  );
}

function AboutTab({ me, summary, today }: { me: Me; summary: HomeSummary; today: string }) {
  const s = summary.subject;
  // Built like More's settings rows (a glyph, medium weight): a feature's colour only where the
  // row is that feature (medicine), and red for Emergency (DESIGN.md rule 7).
  const groups: { title: string; rows: { href: string; icon: IconName; label: string; tone?: "meds" | "danger"; show?: boolean }[] }[] = [
    {
      title: "Health",
      rows: [
        { href: "/baby/doctor", icon: "phone", label: "Doctor" },
        { href: "/baby/when-to-call", icon: "clipboard", label: "When to call" },
        { href: "/baby/vaccines", icon: "syringe", label: "Vaccines", tone: "meds" },
        { href: "/baby/medicine", icon: "clock", label: "Medicine", tone: "meds" },
        { href: "/baby/emergency", icon: "bell", label: "Emergency", tone: "danger" },
        { href: "/baby/export", icon: "printer", label: "For the doctor" },
      ],
    },
    {
      title: "Growing",
      rows: [
        { href: "/baby/trends", icon: "trend", label: "Growth and trends" },
        { href: "/baby/milestones", icon: "star", label: "Firsts" },
        { href: "/baby/weeks", icon: "calendar", label: "Week by week" },
        { href: "/baby/activities", icon: "sparkles", label: "Play" },
        { href: "/baby/story", icon: "note", label: "Story" },
      ],
    },
    {
      title: "Care",
      rows: [
        { href: "/baby/handover", icon: "users", label: "Handover" },
        { href: "/ask?from=child", icon: "chat", label: `Ask about ${s.name}`, show: can(me, "assistant", "view") },
      ],
    },
  ];
  return (
    <>
      {s.birth_date && (
        <Fold title="What this age brings" icon="star" tint="guide">
          <PhaseCard ageDays={ageDays(s.birth_date, today)} name={s.name} />
        </Fold>
      )}
      {groups.map((g) => (
        <section key={g.title} className="flex flex-col gap-2">
          <h2 className="section-title">{g.title}</h2>
          <nav aria-label={g.title} className="card flex flex-col p-0">
            {g.rows
              .filter((r) => r.show !== false)
              .map((r) => (
                <Link prefetch={false} key={r.href} href={r.href} className="row row-link px-4">
                  <span className={`flex w-8 shrink-0 justify-center ${r.tone === "meds" ? "text-[var(--meds-fg)]" : r.tone === "danger" ? "text-[var(--danger)]" : "text-[var(--accent)]"}`}>
                    <Icon name={r.icon} size={20} />
                  </span>
                  <span className="flex-1 font-medium">{r.label}</span>
                  <Icon name="forward" size={18} className="muted" />
                </Link>
              ))}
          </nav>
        </section>
      ))}
    </>
  );
}
