import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CalendarData,
  EntryRow,
  HomeSummary,
  Me,
  RpcError,
  Suggestion,
} from "@/lib/types";
import { can } from "@/lib/types";
import { addDays, fmtDuration, fmtTime, todayYmd } from "@/lib/time";
import { getBrief } from "@/lib/assistant/brief";
import {
  napPattern,
  nextNap,
  type NapPattern,
  type NextNap,
} from "@/lib/child-insights";
import { birthdayMonth } from "@/lib/story";
import { ageDays as ageDaysOf, ageWords } from "@/lib/norms";
import { isToddler } from "@/lib/stage";
import { readDay } from "@/lib/day";
import { draftPlan } from "@/lib/plan/draft";
import { memberClient, serviceClient } from "@/lib/server/member";
import { childName, childPronouns } from "@/lib/names";
import { notifyMember, plain } from "./send";

/**
 * The scheduled jobs. Each member with a phone switched on is visited with a
 * client that carries *their* identity, so the brief, the suggestions and the
 * reminders are computed under their own permissions. The client names the
 * member row too: a person in two homes is two members, each visited for their
 * own home. The service client is only used to find those members and to send.
 */

interface Target {
  member_id: string;
  user_id: string;
}

/**
 * The monthly birthday push's title: "Lana is 5 months old today", "Yusuf is 3 years old
 * today". The age words every screen uses (lib/norms ageWords); months 1 to 3 keep "1 month"
 * to "3 months", where those words would still count weeks.
 */
export function birthdayTitle(name: string, birthDate: string, today: string, month: number): string {
  return `${name} is ${month < 4 ? `${month} month${month === 1 ? "" : "s"}` : ageWords(birthDate, today)} old today`;
}

/**
 * The nap push's words. A baby's as they always were, in minutes. A toddler's awake times in
 * hours and minutes (R5). The basis names the child ("her rhythm" for a girl, as before).
 */
export function napPushBody(n: Pick<NextNap, "awakeMin" | "windowMin" | "basis">, toddler: boolean, their: string): string {
  const time = (min: number) => (toddler ? fmtDuration(min) : `${min} min`);
  return `Awake ${time(n.awakeMin)}; ${their} window is about ${time(n.windowMin)} (${n.basis.replace(/^her /, `${their} `)}). Start the wind-down.`;
}

/**
 * The nap pattern the nap push goes by (napPattern). Where the family said how many naps in
 * "{Name}'s day", their answer stands in for the week: no push when it says no nap, and one
 * when it says a nap though none was logged lately. A baby's, and a toddler's with no day,
 * is the log's as before.
 */
export function napPushPattern(
  entries: EntryRow[],
  subject: Pick<HomeSummary["subject"], "birth_date" | "settings">,
  age: number,
  now: number,
  tz: string,
  from: number,
): NapPattern {
  const day = readDay(subject.settings, age, subject.birth_date);
  return napPattern(entries, age, now, tz, from, day?.naps ?? null);
}

/**
 * What the nap push goes by: the next nap, or null where none is sent. A toddler with no nap
 * expected (by the child's own week, or because the family says no nap) gets no push at all.
 */
export function napPushNext(
  entries: EntryRow[],
  subject: Pick<HomeSummary["subject"], "birth_date" | "settings">,
  age: number,
  now: number,
  tz: string,
  from: number,
  hourOf: (iso: string) => number,
): NextNap | null {
  const pattern = napPushPattern(entries, subject, age, now, tz, from);
  return isToddler(age) && !pattern.expected
    ? null
    : nextNap(entries, age, now, hourOf, pattern);
}

async function targets(service: SupabaseClient): Promise<Target[]> {
  const { data } = await service
    .from("push_subscriptions")
    .select("member_id, members!inner(user_id, is_active)")
    .eq("is_active", true);
  const seen = new Map<string, Target>();
  for (const row of (data as
    | {
        member_id: string;
        members: { user_id: string | null; is_active: boolean };
      }[]
    | null) ?? []) {
    if (
      row.members?.user_id &&
      row.members.is_active &&
      !seen.has(row.member_id)
    )
      seen.set(row.member_id, {
        member_id: row.member_id,
        user_id: row.members.user_id,
      });
  }
  return Array.from(seen.values());
}

async function meOf(client: SupabaseClient): Promise<Me | null> {
  const { data } = await client.rpc("me");
  const me = data as Me | RpcError | null;
  return me && me.ok ? me : null;
}

export interface CronReport {
  members: number;
  sent: number;
  skipped: number;
  errors: string[];
  detail: Record<string, string[]>;
}

/** Once a day, early morning: the brief, open suggestions, and on Sundays the plan draft. */
export async function runDaily(): Promise<CronReport> {
  const service = serviceClient();
  const report: CronReport = {
    members: 0,
    sent: 0,
    skipped: 0,
    errors: [],
    detail: {},
  };
  for (const t of await targets(service)) {
    report.members += 1;
    const log: string[] = [];
    // Sent counts once; no phone or already sent is a skip; a phone the push service refused is a delivery error.
    const count = (
      r: { sent: number; failed?: number; skipped?: string },
      what: string,
    ) => {
      log.push(
        `${what} ${r.sent ? "sent" : (r.skipped ?? "failed")}${r.failed ? ` (${r.failed} failed)` : ""}`,
      );
      if (r.sent) report.sent += 1;
      else if (!r.failed) report.skipped += 1;
      if (r.failed)
        report.errors.push(
          `${t.member_id}: ${what} failed on ${r.failed} phone${r.failed === 1 ? "" : "s"}`,
        );
    };
    try {
      const client = await memberClient(t.user_id, t.member_id);
      const me = await meOf(client);
      if (!me) {
        log.push("no member");
        continue;
      }
      const tz = me.household.timezone;
      const today = todayYmd(tz);
      const weekday = new Date().getUTCDay(); // used only to pick the plan day; the brief has the local day

      // 1. The morning brief, written now so it is ready at 7.
      if (can(me, "assistant", "view")) {
        const b = await getBrief(client, me, "morning", false);
        if (b.ok) {
          const r = await notifyMember(service, t.member_id, {
            kind: "brief",
            key: `brief:morning:${today}`,
            title: `Good morning, ${me.member.display_name}`,
            body: plain(b.brief.content),
            url: "/",
          });
          count(r, "brief");
        } else log.push(`brief: ${b.message}`);
      }

      // 2. Things to approve.
      const { data: sug } = await client.rpc("suggestions_refresh");
      // Only the kinds the app still shows (older rows may carry retired kinds).
      const open = (
        ((sug as { suggestions?: Suggestion[] } | null)?.suggestions ??
          []) as Suggestion[]
      ).filter((s) => s.kind === "due");
      if (open.length > 0) {
        const r = await notifyMember(service, t.member_id, {
          kind: "suggestions",
          key: `suggestions:${today}:${open
            .map((s) => s.key)
            .sort()
            .join("|")
            .slice(0, 200)}`,
          title:
            open.length === 1
              ? open[0].title
              : `${open.length} things to look at`,
          body:
            open.length === 1
              ? (open[0].body ?? "")
              : open
                  .map((s) => s.title)
                  .slice(0, 3)
                  .join(" · "),
          url: "/",
        });
        count(r, `suggestions ${open.length}`);
      }

      // 2b. Sunday: "This week for <child>", written now and pushed, for anyone who sees the child's log.
      const localWd = new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        timeZone: tz,
      }).format(new Date());
      if (
        (localWd === "Sun" || process.env.PLAN_EVERY_DAY === "1") &&
        can(me, "assistant", "view") &&
        can(me, "lana", "view")
      ) {
        const w = await getBrief(client, me, "week", false);
        if (w.ok) {
          const r = await notifyMember(service, t.member_id, {
            kind: "brief",
            key: `brief:week:${w.brief.day}`,
            title: `This week for ${childName(me)}`,
            body: plain(w.brief.content, 160),
            url: "/baby",
          });
          count(r, "week note");
        } else log.push(`week note: ${w.message}`);
      }

      // 2c. The child's monthly birthday: the month's story, written now and pushed to everyone who sees the log.
      if (can(me, "assistant", "view") && can(me, "lana", "view")) {
        const { data: sumData } = await client.rpc("home_summary");
        const sum = sumData as HomeSummary | RpcError | null;
        const birth = sum?.ok ? sum.subject.birth_date : null;
        const m = birth ? birthdayMonth(birth, today) : null;
        if (m) {
          const st = await getBrief(client, me, "story", false, { month: m });
          if (st.ok) {
            const r = await notifyMember(service, t.member_id, {
              kind: "brief",
              key: `story:${m}`,
              title: birthdayTitle(sum!.ok ? sum!.subject.name : childName(me), birth!, today, m),
              body: plain(st.brief.content, 160),
              url: `/baby/story/${m}`,
            });
            log.push(`story ${m} ${r.sent ? "sent" : r.skipped}`);
            r.sent ? (report.sent += 1) : (report.skipped += 1);
          } else log.push(`story: ${st.message}`);
        }
      }

      // 3. Sunday: next week's plan, drafted for whoever can put things on the calendar.
      const localWeekday = new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        timeZone: tz,
      }).format(new Date());
      if (
        (localWeekday === "Sun" || process.env.PLAN_EVERY_DAY === "1") &&
        can(me, "calendar", "add") &&
        can(me, "assistant", "view")
      ) {
        const p = await draftPlan(client, me);
        if (p.ok) {
          const r = await notifyMember(service, t.member_id, {
            kind: "plan",
            key: `plan:${addDays(today, 1)}`,
            title: "Next week's plan is drafted",
            body: plain(p.summary, 140),
            url: "/calendar",
          });
          log.push(
            `plan ${p.entries.length} entries: ${r.sent ? "sent" : r.skipped}`,
          );
          r.sent ? (report.sent += 1) : (report.skipped += 1);
        } else log.push(`plan: ${p.message}`);
      }
      void weekday;
    } catch (e) {
      report.errors.push(
        `${t.member_id}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    report.detail[t.member_id] = log;
  }
  return report;
}

/** Every few minutes (when the plan allows): events about to start, the next nap. */
export async function runOften(): Promise<CronReport> {
  const service = serviceClient();
  const report: CronReport = {
    members: 0,
    sent: 0,
    skipped: 0,
    errors: [],
    detail: {},
  };
  const now = Date.now();
  for (const t of await targets(service)) {
    report.members += 1;
    const log: string[] = [];
    try {
      const client = await memberClient(t.user_id, t.member_id);
      const me = await meOf(client);
      if (!me) continue;
      const tz = me.household.timezone;
      const today = todayYmd(tz);

      // Events starting in the next hour.
      if (can(me, "calendar", "view")) {
        const { data } = await client.rpc("calendar_list", {
          p_from: today,
          p_to: today,
        });
        const cal = data as CalendarData | RpcError | null;
        if (cal?.ok) {
          for (const e of cal.events) {
            if (e.all_day) continue;
            const start = new Date(e.starts_at).getTime();
            if (start - now > 60 * 60 * 1000 || start - now < -10 * 60 * 1000)
              continue;
            const r = await notifyMember(service, t.member_id, {
              kind: "event",
              key: `event:${e.id}:${e.starts_at}`,
              title: `${fmtTime(e.starts_at, tz)} · ${e.title}`,
              body: e.assigned_name
                ? `${e.assigned_name}${e.note ? ` · ${e.note}` : ""}`
                : (e.note ?? ""),
              url: "/calendar",
            });
            if (r.sent) {
              report.sent += 1;
              log.push(`event ${e.title}`);
            }
          }
        }
      }
      // The next nap, about ten minutes before the awake window closes, for whoever has the child's log.
      // A baby's from the last 36 hours, as always. A toddler's from the week Home reads, through
      // the one nap rule (napPattern): no push at all when no nap is expected (R5), by the
      // child's own week or by the family's answer (napPushPattern).
      if (can(me, "lana", "view")) {
        const { data: sumData } = await client.rpc("home_summary");
        const sum = sumData as HomeSummary | RpcError | null;
        if (sum?.ok && sum.subject.birth_date) {
          const age = ageDaysOf(sum.subject.birth_date, today);
          const toddler = isToddler(age);
          const from = now - (toddler ? 7 * 86_400_000 : 36 * 3_600_000);
          const { data: listData } = await client.rpc("care_entries_list", {
            p_subject_id: sum.subject.id,
            p_from: new Date(from).toISOString(),
            p_to: new Date(now + 3_600_000).toISOString(),
          });
          const entries = ((listData as { entries?: EntryRow[] } | null)
            ?.entries ?? []) as EntryRow[];
          const hourOf = (iso: string) => {
            const parts = new Intl.DateTimeFormat("en-GB", {
              timeZone: tz,
              hour: "numeric",
              minute: "numeric",
              hourCycle: "h23",
            }).formatToParts(new Date(iso));
            return (
              Number(parts.find((p) => p.type === "hour")?.value ?? 0) +
              Number(parts.find((p) => p.type === "minute")?.value ?? 0) / 60
            );
          };
          const n = napPushNext(
            entries,
            sum.subject,
            age,
            now,
            tz,
            from,
            hourOf,
          );
          if (
            n &&
            n.at != null &&
            n.at - now <= 15 * 60_000 &&
            n.at - now > -5 * 60_000
          ) {
            const slot = new Date(
              Math.round(n.at / (5 * 60_000)) * 5 * 60_000,
            ).toISOString();
            const r = await notifyMember(service, t.member_id, {
              kind: "nap",
              key: `nap:${slot}`,
              title: n.isBedtime
                ? `Bedtime around ${fmtTime(new Date(n.at).toISOString(), tz)}`
                : `Next nap around ${fmtTime(new Date(n.at).toISOString(), tz)}`,
              body: napPushBody(n, toddler, childPronouns(me).their),
              url: "/baby",
            });
            if (r.sent) {
              report.sent += 1;
              log.push(`nap ${slot}`);
            }
          }
        }
      }
    } catch (e) {
      report.errors.push(
        `${t.member_id}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (log.length) report.detail[t.member_id] = log;
  }
  return report;
}
