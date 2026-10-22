import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Me, PlanEntry, RpcError, Suggestion } from "@/lib/types";
import { EVENT_KINDS, can } from "@/lib/types";
import { addDays, todayYmd } from "@/lib/time";
import { buildTools, loadContext } from "@/lib/assistant/tools";
import { stableSystem, volatileSystem } from "@/lib/assistant/prompt";
import { assistantConfigured, MODEL } from "@/lib/assistant/run";
import { anthropicApiKey, anthropicOptions } from "@/lib/server/anthropic";

/**
 * The weekly plan draft: the model looks at the coming week (calendar, who is
 * home and who works, what is due, what is running low, what is broken) and
 * proposes a short plan plus calendar entries. It lands as a suggestion card;
 * nothing goes on the calendar until the member ticks the entries and approves.
 */
const PlanSchema = z.object({
  summary: z.string().describe("The week in 3 to 6 short lines, plain English, for the home screen"),
  entries: z.array(
    z.object({
      title: z.string(),
      kind: z.enum(["event", "plan", "reminder", "routine", "guest", "delivery", "contractor", "appointment"]),
      date: z.string().describe("YYYY-MM-DD within the week"),
      time: z.string().nullable().describe("HH:MM or null for an all-day entry"),
      note: z.string().nullable(),
      why: z.string().describe("One short reason, from the data"),
    }),
  ),
});

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic(anthropicOptions({ timeout: 90_000 }));
  return _client;
}

export async function draftPlan(supabase: SupabaseClient, me: Me): Promise<{ ok: true; suggestion: Suggestion | null; summary: string; entries: PlanEntry[] } | RpcError> {
  if (!can(me, "calendar", "add") || !can(me, "assistant", "view")) return { ok: false, error: "not_allowed", message: "Planning needs the calendar and the assistant." };
  if (!assistantConfigured()) return { ok: false, error: "not_configured", message: "The assistant is not set up yet (no ANTHROPIC_API_SECRET_KEY on the server)." };
  const tz = me.household.timezone;
  const now = new Date();
  const today = todayYmd(tz, now);
  const from = addDays(today, 1);
  const to = addDays(today, 7);

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
  const data = {
    week: { from, to },
    calendar: await run("calendar", { from, to }),
    who_is_home_today: await run("who_is_home", {}),
    due: await run("due_soon", { days_ahead: 14 }),
  };

  const t0 = Date.now();
  const res = await client().beta.messages.parse({
    model: MODEL,
    max_tokens: 2048,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(PlanSchema) },
    system: [
      { type: "text", text: stableSystem(ctx), cache_control: { type: "ephemeral", ttl: "1h" } },
      { type: "text", text: `${volatileSystem(ctx)}\nYou are drafting next week's plan from the data below, not answering a question.` },
    ],
    messages: [
      {
        role: "user",
        content: `Draft the plan for ${from} to ${to} for ${me.member.display_name}. Propose calendar entries ONLY where the data calls for one: a doctor visit for something due (on a day someone is home), a reminder the day before a vaccine or a treatment is due, cover when the carer is off. Never invent events, never move existing ones, never duplicate an entry already on the calendar. At most 6 entries. Times in ${tz}, HH:MM or null. Keep the summary short and plain.\n\nDATA:\n${JSON.stringify(data)}`,
      },
    ],
  });
  const parsed = res.parsed_output;
  const usage = { model: MODEL, input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens, ms: Date.now() - t0 };
  try {
    await supabase.rpc("assistant_audit", { p_kind: "plan", p_question: `plan ${from}..${to}`, p_answer: parsed?.summary ?? "unparsed", p_usage: usage, p_tools: Object.keys(data).map((name) => ({ name, ok: true })) });
  } catch {
    /* best effort */
  }
  if (!parsed) return { ok: false, error: "unparsed", message: "Could not draft the plan this time." };
  const kinds = new Set(EVENT_KINDS.map((k) => k.id));
  const entries: PlanEntry[] = parsed.entries
    .filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date) && e.date >= from && e.date <= to)
    .map((e) => ({ title: e.title.trim(), kind: kinds.has(e.kind) ? e.kind : "plan", date: e.date, time: e.time && /^\d{2}:\d{2}$/.test(e.time) ? e.time : null, note: [e.note, e.why].filter(Boolean).join(" — ") || null }));
  const key = `plan:${from}`;
  await supabase.rpc("suggestion_put", {
    p_kind: "plan",
    p_key: key,
    p_title: `Next week's plan (${from} to ${to})`,
    p_body: parsed.summary,
    p_href: "/calendar",
    p_action: { type: "plan", entries, summary: parsed.summary },
  });
  const { data: list } = await supabase.rpc("suggestions_list");
  const suggestion = (((list as { suggestions?: Suggestion[] } | null)?.suggestions ?? []) as Suggestion[]).find((s) => s.key === key) ?? null;
  return { ok: true, suggestion, summary: parsed.summary, entries };
}
