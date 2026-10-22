import type { SupabaseClient } from "@supabase/supabase-js";
import type { CalendarData, EntryRow, HomeSummary, Me, RpcError, Suggestion } from "@/lib/types";
import { can } from "@/lib/types";
import { addDays, fmtTime, todayYmd } from "@/lib/time";
import { getBrief } from "@/lib/assistant/brief";
import { nextNap } from "@/lib/child-insights";
import { birthdayMonth } from "@/lib/story";
import { ageDays as ageDaysOf } from "@/lib/norms";
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

async function targets(service: SupabaseClient): Promise<Target[]> {
  const { data } = await service.from("push_subscriptions").select("member_id, members!inner(user_id, is_active)").eq("is_active", true);
  const seen = new Map<string, Target>();
  for (const row of (data as { member_id: string; members: { user_id: string | null; is_active: boolean } }[] | null) ?? []) {
    if (row.members?.user_id && row.members.is_active && !seen.has(row.member_id)) seen.set(row.member_id, { member_id: row.member_id, user_id: row.members.user_id });
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
  const report: CronReport = { members: 0, sent: 0, skipped: 0, errors: [], detail: {} };
  for (const t of await targets(service)) {
    report.members += 1;
    const log: string[] = [];
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
          const r = await notifyMember(service, t.member_id, { kind: "brief", key: `brief:morning:${today}`, title: `Good morning, ${me.member.display_name}`, body: plain(b.brief.content), url: "/" });
          log.push(`brief ${r.sent ? "sent" : r.skipped}`);
          r.sent ? (report.sent += 1) : (report.skipped += 1);
        } else log.push(`brief: ${b.message}`);
      }

      // 2. Things to approve.
      const { data: sug } = await client.rpc("suggestions_refresh");
      // Only the kinds the app still shows (older rows may carry retired kinds).
      const open = (((sug as { suggestions?: Suggestion[] } | null)?.suggestions ?? []) as Suggestion[]).filter((s) => s.kind === "due");
      if (open.length > 0) {
        const r = await notifyMember(service, t.member_id, {
          kind: "suggestions",
          key: `suggestions:${today}:${open.map((s) => s.key).sort().join("|").slice(0, 200)}`,
          title: open.length === 1 ? open[0].title : `${open.length} things to look at`,
          body: open.length === 1 ? (open[0].body ?? "") : open.map((s) => s.title).slice(0, 3).join(" · "),
          url: "/",
        });
        log.push(`suggestions ${open.length}: ${r.sent ? "sent" : r.skipped}`);
        r.sent ? (report.sent += 1) : (report.skipped += 1);
      }

      // 2b. Sunday: "This week for <child>", written now and pushed, for anyone who sees the child's log.
      const localWd = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: tz }).format(new Date());
      if ((localWd === "Sun" || process.env.PLAN_EVERY_DAY === "1") && can(me, "assistant", "view") && can(me, "lana", "view")) {
        const w = await getBrief(client, me, "week", false);
        if (w.ok) {
          const r = await notifyMember(service, t.member_id, { kind: "brief", key: `brief:week:${w.brief.day}`, title: `This week for ${childName(me)}`, body: plain(w.brief.content, 160), url: "/baby" });
          log.push(`week note ${r.sent ? "sent" : r.skipped}`);
          r.sent ? (report.sent += 1) : (report.skipped += 1);
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
            const r = await notifyMember(service, t.member_id, { kind: "brief", key: `story:${m}`, title: `${sum!.ok ? sum!.subject.name : childName(me)} is ${m} month${m === 1 ? "" : "s"} old today`, body: plain(st.brief.content, 160), url: `/baby/story/${m}` });
            log.push(`story ${m} ${r.sent ? "sent" : r.skipped}`);
            r.sent ? (report.sent += 1) : (report.skipped += 1);
          } else log.push(`story: ${st.message}`);
        }
      }

      // 3. Sunday: next week's plan, drafted for whoever can put things on the calendar.
      const localWeekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: tz }).format(new Date());
      if ((localWeekday === "Sun" || process.env.PLAN_EVERY_DAY === "1") && can(me, "calendar", "add") && can(me, "assistant", "view")) {
        const p = await draftPlan(client, me);
        if (p.ok) {
          const r = await notifyMember(service, t.member_id, { kind: "plan", key: `plan:${addDays(today, 1)}`, title: "Next week's plan is drafted", body: plain(p.summary, 140), url: "/calendar" });
          log.push(`plan ${p.entries.length} entries: ${r.sent ? "sent" : r.skipped}`);
          r.sent ? (report.sent += 1) : (report.skipped += 1);
        } else log.push(`plan: ${p.message}`);
      }
      void weekday;
    } catch (e) {
      report.errors.push(`${t.member_id}: ${e instanceof Error ? e.message : String(e)}`);
    }
    report.detail[t.member_id] = log;
  }
  return report;
}

/** Every few minutes (when the plan allows): events about to start, the next nap. */
export async function runOften(): Promise<CronReport> {
  const service = serviceClient();
  const report: CronReport = { members: 0, sent: 0, skipped: 0, errors: [], detail: {} };
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
        const { data } = await client.rpc("calendar_list", { p_from: today, p_to: today });
        const cal = data as CalendarData | RpcError | null;
        if (cal?.ok) {
          for (const e of cal.events) {
            if (e.all_day) continue;
            const start = new Date(e.starts_at).getTime();
            if (start - now > 60 * 60 * 1000 || start - now < -10 * 60 * 1000) continue;
            const r = await notifyMember(service, t.member_id, { kind: "event", key: `event:${e.id}:${e.starts_at}`, title: `${fmtTime(e.starts_at, tz)} · ${e.title}`, body: e.assigned_name ? `${e.assigned_name}${e.note ? ` · ${e.note}` : ""}` : (e.note ?? ""), url: "/calendar" });
            if (r.sent) {
              report.sent += 1;
              log.push(`event ${e.title}`);
            }
          }
        }
      }
      // The next nap, about ten minutes before the awake window closes, for whoever has the child's log.
      if (can(me, "lana", "view")) {
        const { data: sumData } = await client.rpc("home_summary");
        const sum = sumData as HomeSummary | RpcError | null;
        if (sum?.ok && sum.subject.birth_date) {
          const { data: listData } = await client.rpc("care_entries_list", { p_subject_id: sum.subject.id, p_from: new Date(now - 36 * 3_600_000).toISOString(), p_to: new Date(now + 3_600_000).toISOString() });
          const entries = ((listData as { entries?: EntryRow[] } | null)?.entries ?? []) as EntryRow[];
          const hourOf = (iso: string) => {
            const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date(iso));
            return Number(parts.find((p) => p.type === "hour")?.value ?? 0) + Number(parts.find((p) => p.type === "minute")?.value ?? 0) / 60;
          };
          const n = nextNap(entries, ageDaysOf(sum.subject.birth_date, today), now, hourOf);
          if (n && n.at != null && n.at - now <= 15 * 60_000 && n.at - now > -5 * 60_000) {
            const slot = new Date(Math.round(n.at / (5 * 60_000)) * 5 * 60_000).toISOString();
            const r = await notifyMember(service, t.member_id, { kind: "nap", key: `nap:${slot}`, title: n.isBedtime ? `Bedtime around ${fmtTime(new Date(n.at).toISOString(), tz)}` : `Next nap around ${fmtTime(new Date(n.at).toISOString(), tz)}`, body: `Awake ${n.awakeMin} min; ${childPronouns(me).their} window is about ${n.windowMin} min (${n.basis}). Start the wind-down.`, url: "/baby" });
            if (r.sent) {
              report.sent += 1;
              log.push(`nap ${slot}`);
            }
          }
        }
      }
    } catch (e) {
      report.errors.push(`${t.member_id}: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (log.length) report.detail[t.member_id] = log;
  }
  return report;
}
