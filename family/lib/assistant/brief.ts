import type { SupabaseClient } from "@supabase/supabase-js";
import type { Brief, Me, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { addDays, todayYmd } from "@/lib/time";
import { ageOutlook } from "@/lib/lana-insights";
import { buildTools, loadContext } from "./tools";
import { stableSystem, volatileSystem } from "./prompt";
import { assistantConfigured, compose, MODEL } from "./run";

export type BriefKind = "morning" | "evening" | "week";

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
export async function getBrief(supabase: SupabaseClient, me: Me, kind: BriefKind, refresh = false): Promise<{ ok: true; brief: Brief; fresh: boolean } | RpcError> {
  if (!can(me, "assistant", "view")) return { ok: false, error: "not_allowed", message: "The assistant is not switched on for your role." };
  const tz = me.household.timezone;
  const now = new Date();
  const today = todayYmd(tz, now);
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
      wk[`${s.name}_last_week`] = await run("care_stats", { subject: s.name, from: addDays(today, -7), to: addDays(today, -1) });
      wk[`${s.name}_sleep_rhythm`] = await run("sleep_rhythm", { subject: s.name });
      wk[`${s.name}_plan`] = await run("coach_plan", { subject: s.name });
      const { data: acts } = await supabase.rpc("activities_list", { p_subject_id: s.id });
      const items = ((acts as { items?: { title: string; how: string; band: string; done_on: string | null }[] } | null)?.items ?? []).filter((a) => a.band === "now" && !a.done_on).slice(0, 3);
      wk[`${s.name}_play_ideas`] = items.map((a) => `${a.title}: ${a.how}`);
    }
    wk.due_soon = await run("due_soon", { days_ahead: 10 });
    const askWeek = `Write "This week for ${kids.map((s) => s.name).join(" and ") || "the baby"}" for ${me.member.display_name}: a short weekly note. In this order: 1) what her age usually brings this week (from the age outlook: the phase she is in, what is coming and in how many days), in two or three plain sentences; 2) how last week went in numbers (feeds, sleep, longest stretch, nappies) and one thing that stands out, citing [entry:ID] only where the data gives ids; 3) one or two gentle things to try this week, from the sleep rhythm and the play ideas given (name the idea); 4) anything due in the next 10 days (vaccines, appointments). Under 160 words, short lines. No diagnoses, no doses. Leave out empty sections.`;
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
    shopping_running_low: await run("shopping_list", { only_needed: true }),
    house_open: await run("house", { status: "open" }),
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
