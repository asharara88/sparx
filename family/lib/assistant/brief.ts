import type { SupabaseClient } from "@supabase/supabase-js";
import type { Brief, Me, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { addDays, todayYmd } from "@/lib/time";
import { ageOutlook } from "@/lib/child-insights";
import { leapWeek } from "@/lib/leaps";
import { storyMonth } from "@/lib/story";
import { buildTools, loadContext } from "./tools";
import { stableSystem, volatileSystem } from "./prompt";
import { assistantConfigured, compose, MODEL } from "./run";

export type BriefKind = "morning" | "evening" | "week" | "story";

/** The morning brief is for today; the evening digest is "what happened today". */
export function briefKindNow(tz: string, now = new Date()): BriefKind {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(now));
  return hour >= 17 ? "evening" : "morning";
}

async function audit(supabase: SupabaseClient, args: Record<string, unknown>) {
  try {
    await supabase.rpc("assistant_audit", { p_kind: "brief", ...args });
  } catch {
    /* best effort */
  }
}

/**
 * Get today's brief for the member; generate it the first time it is asked for
 * (or when refresh is set). Gathering is deterministic and permission-bound (the
 * same tools the chat uses); the model only writes the words.
 */
export async function getBrief(supabase: SupabaseClient, me: Me, kind: BriefKind, refresh = false, opts: { month?: number } = {}): Promise<{ ok: true; brief: Brief; fresh: boolean } | RpcError> {
  if (!can(me, "assistant", "view")) return { ok: false, error: "not_allowed", message: "The assistant is not switched on for your role." };
  const tz = me.household.timezone;
  const now = new Date();
  const today = todayYmd(tz, now);
  if (kind === "story") return getStory(supabase, me, opts.month ?? 0, refresh, today);
  // The weekly note is keyed by its week's Sunday, so it is written once a week.
  const day = kind === "week" ? addDays(today, -new Date(`${today}T12:00:00Z`).getUTCDay()) : today;

  if (!refresh) {
    const { data } = await supabase.rpc("assistant_brief_get", { p_day: day, p_kind: kind });
    const got = data as { ok: boolean; brief: Brief | null } | null;
    if (got?.ok && got.brief) return { ok: true, brief: got.brief, fresh: false };
  }
  if (!assistantConfigured()) return { ok: false, error: "not_configured", message: "The assistant is not set up yet (no ANTHROPIC_API_SECRET_KEY on the server)." };

  const ctx = await loadContext(supabase, me, now);
  const tools = new Map(buildTools(ctx).map((t) => [t.def.name, t]));
  const run = async (name: string, input: Record<string, unknown>) => {
    const t = tools.get(name);
    if (!t) return undefined;
    try {
      return await t.run(input, ctx);
    } catch (e) {
      return { error: e instanceof Error ? e.message : "failed" };
    }
  };

  if (kind === "week") {
    const kids = ctx.subjects.filter((s) => s.kind === "child" && can(me, s.module_id, "view"));
    const wk: Record<string, unknown> = {};
    for (const s of kids) {
      const ageDays = s.birth_date ? Math.floor((now.getTime() - Date.parse(s.birth_date)) / 86_400_000) : null;
      wk[`${s.name}_age`] = ageDays != null ? ageOutlook(ageDays) : null;
      const lw = ageDays != null ? leapWeek(ageDays) : null;
      wk[`${s.name}_week`] = lw ? { week: lw.week, stretch: lw.band.title, expect: lw.band.expect, often_harder: lw.band.tough, tip: lw.band.tip, next: lw.next?.title ?? null, weeks_to_next: lw.weeksToNext } : null;
      wk[`${s.name}_last_week`] = await run("care_stats", { subject: s.name, from: addDays(today, -7), to: addDays(today, -1) });
      wk[`${s.name}_sleep_rhythm`] = await run("sleep_rhythm", { subject: s.name });
      wk[`${s.name}_plan`] = await run("coach_plan", { subject: s.name });
      const { data: acts } = await supabase.rpc("activities_list", { p_subject_id: s.id });
      const items = ((acts as { items?: { title: string; how: string; band: string; done_on: string | null }[] } | null)?.items ?? []).filter((a) => a.band === "now" && !a.done_on).slice(0, 3);
      wk[`${s.name}_play_ideas`] = items.map((a) => `${a.title}: ${a.how}`);
    }
    wk.due_soon = await run("due_soon", { days_ahead: 10 });
    const askWeek = `Write "This week for ${kids.map((s) => s.name).join(" and ") || "the baby"}" for ${me.member.display_name}: a short weekly note. In this order: 1) what her age usually brings this week (from the week calendar and the age outlook: the week she is in, the stretch it belongs to, what is coming and in how many days or weeks), in two or three plain sentences; 2) how last week went in numbers (feeds, sleep, longest stretch, nappies) and one thing that stands out, citing [entry:ID] only where the data gives ids; 3) one or two gentle things to try this week, from the sleep rhythm and the play ideas given (name the idea); 4) anything due in the next 10 days (vaccines, appointments). Under 160 words, short lines. No diagnoses, no doses. Leave out empty sections.`;
    const t0w = Date.now();
    const resW = await compose(
      [
        { type: "text", text: stableSystem(ctx), cache_control: { type: "ephemeral", ttl: "1h" } },
        { type: "text", text: `${volatileSystem(ctx)}\nYou are writing a weekly note, not answering a question. The data below is everything you may use.` },
      ],
      `${askWeek}\n\nDATA:\n${JSON.stringify(wk)}`,
    );
    const contentW = resW.refusal ? "I could not write the weekly note this time." : resW.text || "Nothing to report.";
    const usageW = { ...resW.usage, ms: Date.now() - t0w };
    const { data: savedW } = await supabase.rpc("assistant_brief_save", { p_day: day, p_kind: kind, p_content: contentW, p_model: MODEL, p_usage: usageW, p_refs: ctx.refs });
    await audit(supabase, { p_question: `week note ${day}`, p_answer: contentW, p_usage: usageW, p_tools: Object.keys(wk).map((name) => ({ name, ok: true })) });
    const idW = ((savedW as { id?: string } | null)?.id ?? "") as string;
    return { ok: true, fresh: true, brief: { id: idW, day, kind, content: contentW, created_at: new Date().toISOString(), model: MODEL, refs: ctx.refs } };
  }

  const yesterday = addDays(day, -1);
  const data: Record<string, unknown> = {
    who_is_home: await run("who_is_home", {}),
    calendar: await run("calendar", { from: kind === "morning" ? day : day, to: addDays(day, 1) }),
    due_soon: await run("due_soon", { days_ahead: 7 }),
  };
  for (const s of ctx.subjects) {
    if (!can(me, s.module_id, "view")) continue;
    data[`${s.name}_now`] = await run("care_now", { subject: s.name });
    if (s.kind === "child") {
      // The night belongs to the morning brief; the whole day to the evening digest.
      data[`${s.name}_${kind === "morning" ? "last_night" : "today"}`] = await run("care_entries", {
        subject: s.name,
        from: kind === "morning" ? `${yesterday} 18:00` : day,
      });
      if (kind === "evening") data[`${s.name}_week`] = await run("care_stats", { subject: s.name, from: addDays(day, -6), to: day });
    }
  }

  const ask =
    kind === "morning"
      ? `Write this morning's brief for ${me.member.display_name}. Cover, in this order and only if there is something to say: how the night went for the baby (sleep stretches, night feeds, wake-ups; what is still running now); milk for the day if the log shows pumping (ml pumped since last evening against the household target of ${me.household.milk_target_ml ?? 400} ml, and what has already gone into bottles); who is home today and who is working; what is on today's calendar; anything due or overdue (treatments, next meal); what is running low; anything open or urgent in the house. Under 150 words. Short lines or bullets. Cite with [entry:ID] / [event:ID] / [ticket:ID] / [item:ID] as instructed. If a section has nothing, leave it out rather than saying "nothing".`
      : `Write this evening's digest of what happened today for ${me.member.display_name}: the baby's day in numbers (feeds and ml or minutes, naps and total sleep, diapers, medicine) and anything unusual against the week; what was logged for the cat; what got done in the house; what is on tomorrow's calendar and who is home; what is due tomorrow. Under 150 words. Short lines or bullets. Cite with [entry:ID] / [event:ID] / [ticket:ID] / [item:ID] as instructed. Leave out empty sections.`;

  const t0 = Date.now();
  const res = await compose(
    [
      { type: "text", text: stableSystem(ctx), cache_control: { type: "ephemeral", ttl: "1h" } },
      { type: "text", text: `${volatileSystem(ctx)}\nYou are writing a brief, not answering a question. The data below is everything you may use.` },
    ],
    `${ask}\n\nDATA:\n${JSON.stringify(data)}`,
  );
  const content = res.refusal ? "I could not write the brief this time." : res.text || "Nothing to report.";
  const usage = { ...res.usage, ms: Date.now() - t0 };
  const { data: saved } = await supabase.rpc("assistant_brief_save", { p_day: day, p_kind: kind, p_content: content, p_model: MODEL, p_usage: usage, p_refs: ctx.refs });
  await audit(supabase, { p_question: `${kind} brief ${day}`, p_answer: content, p_usage: usage, p_tools: Object.keys(data).map((name) => ({ name, ok: true })) });
  const id = ((saved as { id?: string } | null)?.id ?? "") as string;
  return { ok: true, fresh: true, brief: { id, day, kind, content, created_at: new Date().toISOString(), model: MODEL, refs: ctx.refs } };
}

/**
 * The monthly story: month N of her life in a warm page, written once from the
 * log (firsts, the numbers, what was tried, what the age brings) and kept.
 * Keyed by the monthly birthday that closes the month. A month still running
 * is written as "so far" and rewritten on request.
 */
async function getStory(supabase: SupabaseClient, me: Me, month: number, refresh: boolean, today: string): Promise<{ ok: true; brief: Brief; fresh: boolean } | RpcError> {
  const ctx = await loadContext(supabase, me, new Date());
  const kid = ctx.subjects.find((s) => s.kind === "child" && s.birth_date && can(me, s.module_id, "view"));
  if (!kid || !kid.birth_date) return { ok: false, error: "no_subject", message: "No child with a birth date to write about." };
  const span = storyMonth(kid.birth_date, month, today);
  if (!span) return { ok: false, error: "bad_month", message: "That month has not started." };
  const day = span.birthday;
  if (!refresh && !span.inProgress) {
    const { data } = await supabase.rpc("assistant_brief_get", { p_day: day, p_kind: "story" });
    const got = data as { ok: boolean; brief: Brief | null } | null;
    if (got?.ok && got.brief) return { ok: true, brief: got.brief, fresh: false };
  } else if (!refresh) {
    const { data } = await supabase.rpc("assistant_brief_get", { p_day: day, p_kind: "story" });
    const got = data as { ok: boolean; brief: Brief | null } | null;
    // A running month is rewritten at most once a day.
    if (got?.ok && got.brief && got.brief.created_at.slice(0, 10) === today) return { ok: true, brief: got.brief, fresh: false };
  }
  if (!assistantConfigured()) return { ok: false, error: "not_configured", message: "The assistant is not set up yet (no ANTHROPIC_API_SECRET_KEY on the server)." };

  const tools = new Map(buildTools(ctx).map((t) => [t.def.name, t]));
  const run = async (name: string, input: Record<string, unknown>) => {
    const t = tools.get(name);
    if (!t) return undefined;
    try {
      return await t.run(input, ctx);
    } catch (e) {
      return { error: e instanceof Error ? e.message : "failed" };
    }
  };
  const ageAtEnd = Math.floor((Date.parse(span.to) - Date.parse(kid.birth_date)) / 86_400_000);
  const stats = (await run("care_stats", { subject: kid.name, from: span.from, to: span.to })) as { days?: Record<string, unknown>[] } | undefined;
  const days = stats?.days ?? [];
  const num = (k: string) => days.reduce((a, d) => a + Number(d[k] ?? 0), 0);
  const firstW = days.find((d) => d.weight_kg != null)?.weight_kg ?? null;
  const lastW = [...days].reverse().find((d) => d.weight_kg != null)?.weight_kg ?? null;
  const { data: doneData } = await supabase.rpc("activity_done_list", { p_subject_id: kid.id, p_from: span.from, p_to: span.to });
  const tried = (((doneData as { items?: { title: string; done_on: string; done_by: string | null }[] } | null)?.items ?? []) as { title: string; done_on: string; done_by: string | null }[]).map((a) => `${a.title} (${a.done_on}${a.done_by ? `, ${a.done_by}` : ""})`);
  const w = leapWeek(ageAtEnd);
  const data = {
    month,
    from: span.from,
    to: span.to,
    in_progress: span.inProgress,
    days_logged: days.length,
    firsts: days.flatMap((d) => ((d.milestones as string[] | undefined) ?? []).map((m) => ({ day: d.day, what: m }))),
    numbers: {
      breastfeeds: num("breast_count"),
      bottles: num("bottle_count"),
      bottle_ml: num("bottle_ml"),
      sleep_hours_per_day: days.length ? Math.round((num("sleep_min") / days.length / 60) * 10) / 10 : null,
      longest_stretch_min: Math.max(0, ...days.map((d) => Number(d.longest_stretch_min ?? 0))),
      nappies: num("diapers_wet") + num("diapers_dirty"),
      weight_start_kg: firstW,
      weight_end_kg: lastW,
    },
    tried,
    age_now: ageOutlook(ageAtEnd),
    week_now: w ? { week: w.week, stretch: w.band.title, expect: w.band.expect, next: w.next?.title ?? null } : null,
  };
  const ask = `Write "${kid.name}'s month ${month}" for ${me.member.display_name}: a short keepsake page about this month of her life${span.inProgress ? " so far" : ""}, in the second person plural ("you") to the family. Warm, plain, no baby-talk and no exclamation marks. In this order: 1) her firsts this month, by name and date, if any; 2) how the days went in a few numbers (feeds, sleep, the longest stretch, nappies, weight if given), as a sentence or two, not a list; 3) what you tried together (name two or three of the ideas tried, if any); 4) one or two sentences on what this age usually brings next. Between 120 and 180 words. No diagnoses, no doses, no advice beyond "what comes next". Leave out empty sections without comment.`;
  const t0 = Date.now();
  const res = await compose(
    [
      { type: "text", text: stableSystem(ctx), cache_control: { type: "ephemeral", ttl: "1h" } },
      { type: "text", text: `${volatileSystem(ctx)}\nYou are writing a keepsake page, not answering a question. The data below is everything you may use.` },
    ],
    `${ask}\n\nDATA:\n${JSON.stringify(data)}`,
  );
  const content = res.refusal ? "I could not write this month's story this time." : res.text || "Nothing to tell yet.";
  const usage = { ...res.usage, ms: Date.now() - t0 };
  const { data: saved } = await supabase.rpc("assistant_brief_save", { p_day: day, p_kind: "story", p_content: content, p_model: MODEL, p_usage: usage, p_refs: {} });
  await audit(supabase, { p_question: `story month ${month}`, p_answer: content, p_usage: usage, p_tools: [{ name: "care_stats", ok: true }, { name: "activity_done_list", ok: true }] });
  const id = ((saved as { id?: string } | null)?.id ?? "") as string;
  return { ok: true, fresh: true, brief: { id, day, kind: "story", content, created_at: new Date().toISOString(), model: MODEL, refs: {} } };
}
