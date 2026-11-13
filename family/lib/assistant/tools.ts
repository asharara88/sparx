import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssistantChoice, AssistantProposal, AssistantRef, AssistantSkill, EntryType, EventKind, FieldDef, Me } from "@/lib/types";
import { selectSkills, skillText, type Selection } from "./skills";
import { MAX_FACTS, selectMemories, type ChatRecap, type MemoryFact } from "./memory";
import { EVENT_KINDS, can } from "@/lib/types";
import { addDays, dayRange, parseHouseholdTime, todayYmd, toLocalInput } from "@/lib/time";
import { sleepCoach, awakeWindow, ageOutlook, daySchedule } from "@/lib/child-insights";
import { leapWeek } from "@/lib/leaps";
import { ageInDays } from "@/lib/stage";
import { tipsFor } from "@/lib/child-guide";
import type { EntryRow } from "@/lib/types";
import { ambulanceOf } from "@/lib/emergency";
import { bottleAction, matchBottle, matchMedicine, matchMember, matchVaccines, mergeEntry, type Bottle, type VaccineItem } from "./write-match";

/**
 * The assistant's tools are thin wrappers over the RPCs the screens already use,
 * called with the member's own session. Row Level Security therefore decides what
 * the assistant can see, exactly as it decides what the member can see. A tool
 * is only offered when the member has the permission the screen would need, so
 * a home carer's assistant has no child-log tool at all — nothing to leak.
 */

export interface SubjectInfo {
  id: string;
  name: string;
  module_id: string;
  kind: "child";
  birth_date: string | null;
  /** From the profile: "Girl", "Boy", "Female"… or null. */
  sex?: string | null;
  /** Pets only, from the profile: "cat", "dog"… or null. */
  species?: string | null;
  /** The ambulance number the family gave (profile.emergency_ambulance), or null. */
  ambulance?: string | null;
}

export interface ToolContext {
  supabase: SupabaseClient;
  me: Me;
  tz: string;
  now: Date;
  /** Set when the member ends the conversation: every RPC a tool makes is cut short with it. */
  signal?: AbortSignal;
  subjects: SubjectInfo[];
  types: EntryType[];
  /** Members with a written routine ("works 9 to 5"), for the prompt. */
  routines: { name: string; routine: string }[];
  /** Every active member the asker may see: id (to hand the child over), first name, role label and relationship ("Mido's mother"). */
  people: { id: string; name: string; role: string; relationship: string | null }[];
  /** What the family told the assistant to remember (and what it noticed itself), the ones that matter for this question. */
  memories: MemoryFact[];
  /** All live facts with ids (for forget_memory). */
  facts: MemoryFact[];
  /** This member's recent chats, one line each. */
  recaps: ChatRecap[];
  /** Every id the tools returned, so the answer's citations become links. */
  refs: Record<string, AssistantRef>;
  /** Writes the assistant asked for. The member confirms them in the UI. */
  proposals: AssistantProposal[];
  /** A question the member answers with one tap (ask_choice); at most one per answer. */
  choice: AssistantChoice | null;
  /** Every active skill (for the index and load_skill). */
  skills: AssistantSkill[];
  /** What the router picked for this question. */
  selection: Selection;
  /** Skills the model pulled in itself with load_skill, in order. */
  loaded: AssistantSkill[];
  /** The screen the member came from (home, lana, milk, plan…), if the app said. */
  screen: string | null;
  /** The situation snapshot, filled in by the run. */
  situation: string;
  /** The earlier part of a long chat, one line per question, when the turns were cut. */
  digest?: string;
}

export interface AssistantTool {
  def: Anthropic.Beta.BetaTool;
  run: (input: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

type Rpc = { ok: boolean; message?: string; error?: string } & Record<string, unknown>;

async function rpc(ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<Rpc> {
  const q = ctx.supabase.rpc(name, args);
  const { data, error } = await (ctx.signal ? q.abortSignal(ctx.signal) : q);
  if (error) return { ok: false, error: "rpc_failed", message: error.message };
  return (data as Rpc) ?? { ok: false, error: "empty" };
}

/** Local wall-clock for the model: "2026-10-11 14:10". */
export function local(iso: string | null | undefined, tz: string): string | null {
  if (!iso) return null;
  return toLocalInput(iso, tz).replace("T", " ");
}

/**
 * A time bound for a *read* ("2026-10-11", "2026-10-11 14:10", an ISO instant,
 * household timezone); anything unreadable falls back, since a wrong window
 * only changes what is listed. Writes use whenGiven() below and never guess.
 */
export function parseWhen(s: string | null | undefined, tz: string, fallback: Date): string {
  return parseHouseholdTime(s, tz) ?? fallback.toISOString();
}

/**
 * A time the member gave for something to write: absent means now, readable
 * means that instant, and anything else is an error back to the model, so a
 * misheard "half past" is a question to the member rather than "now".
 */
function whenGiven(s: unknown, ctx: ToolContext): { at: string } | { error: "bad_time"; given: string; message: string } {
  if (s === undefined || s === null || String(s).trim() === "") return { at: ctx.now.toISOString() };
  const at = parseHouseholdTime(String(s), ctx.tz);
  if (!at) return { error: "bad_time", given: String(s), message: "Could not read that time. Ask the member when exactly and call again with 'YYYY-MM-DD HH:MM' household time. Never assume now." };
  return { at };
}

function findSubject(ctx: ToolContext, name: unknown): SubjectInfo | null {
  const q = String(name ?? "").trim().toLowerCase();
  if (!q) return ctx.subjects[0] ?? null;
  return ctx.subjects.find((s) => s.name.toLowerCase() === q || s.module_id === q) ?? ctx.subjects.find((s) => s.name.toLowerCase().startsWith(q)) ?? null;
}

function entryRef(ctx: ToolContext, e: { id: string; type_label?: string; occurred_at: string }, module: string) {
  ctx.refs[e.id] = { href: `/${module}/entry/${e.id}`, label: `${e.type_label ?? "Entry"} ${local(e.occurred_at, ctx.tz)?.slice(11) ?? ""}`.trim() };
}

function trimEntry(ctx: ToolContext, e: Record<string, unknown>, module: string) {
  entryRef(ctx, e as { id: string; type_label?: string; occurred_at: string }, module);
  return {
    id: e.id,
    type: e.type_id,
    label: e.type_label,
    at: local(e.occurred_at as string, ctx.tz),
    ended: local(e.ended_at as string | null, ctx.tz),
    ...(e.payload && Object.keys(e.payload as object).length ? { details: e.payload } : {}),
    ...(e.note ? { note: e.note } : {}),
    by: (e.by as string) ?? (e.attributed_name as string) ?? (e.logged_by_name as string) ?? null,
  };
}

const obj = (properties: Record<string, unknown>, required: string[] = []): Anthropic.Beta.BetaTool.InputSchema => ({
  type: "object",
  properties,
  required,
});

const SUBJECT_PROP = (ctx: ToolContext) => ({
  type: "string",
  description: `Who: one of ${ctx.subjects.map((s) => s.name).join(", ") || "(nobody)"}.`,
});

// ---------------------------------------------------------------------------
// Read tools
// ---------------------------------------------------------------------------
function whoIsHome(): AssistantTool {
  return {
    def: {
      name: "who_is_home",
      description: "Who is in the house today, who is away, and who is working today (staff work days). Use for 'who's home', 'is the home carer working', 'where is grandma'.",
      input_schema: obj({}),
    },
    run: async (_input, ctx) => {
      const r = await rpc(ctx, "household_today", {});
      if (!r.ok) return r;
      const members = (r.members as Record<string, unknown>[]) ?? [];
      return {
        today: r.today,
        members: members.map((m) => {
          const p = m.presence as Record<string, unknown> | null;
          return {
            name: m.name,
            role: m.role_id,
            relationship: m.relationship,
            presence: p ? `${p.label}${p.ends_on ? ` until ${p.ends_on}` : ""}${p.note ? ` (${p.note})` : ""}` : "unknown",
            in_house: p ? p.in_house : null,
            works_today: m.works_today,
            work_days: m.work_days,
          };
        }),
      };
    },
  };
}

function calendar(ctx0: ToolContext): AssistantTool {
  const today = todayYmd(ctx0.tz, ctx0.now);
  return {
    def: {
      name: "calendar",
      description: `Events, plans, reminders, guests, deliveries, contractor visits and appointments between two dates (inclusive), plus for each day who is in the house and who works. Today is ${today}. Use for 'what's on Thursday', 'who's home on the weekend', 'when is the vet appointment'.`,
      input_schema: obj(
        {
          from: { type: "string", description: "First day, YYYY-MM-DD." },
          to: { type: "string", description: "Last day, YYYY-MM-DD. At most 31 days after from." },
        },
        ["from", "to"],
      ),
    },
    run: async (input, ctx) => {
      const from = String(input.from ?? today).slice(0, 10);
      let to = String(input.to ?? from).slice(0, 10);
      if (to < from) to = from;
      if (to > addDays(from, 31)) to = addDays(from, 31);
      const r = await rpc(ctx, "calendar_list", { p_from: from, p_to: to });
      if (!r.ok) return r;
      const events = ((r.events as Record<string, unknown>[]) ?? []).map((e) => {
        ctx.refs[e.id as string] = { href: "/calendar", label: `${e.title} ${e.date}` };
        return {
          id: e.id,
          date: e.date,
          time: e.all_day ? "all day" : local(e.starts_at as string, ctx.tz)?.slice(11),
          ends: e.ends_at ? local(e.ends_at as string, ctx.tz)?.slice(11) : null,
          title: e.title,
          kind: e.kind,
          who: e.assigned_name ?? null,
          note: e.note ?? null,
          repeats: e.repeat !== "none" ? e.repeat : undefined,
        };
      });
      const days = ((r.days as Record<string, unknown>[]) ?? []).map((d) => ({ date: d.date, in_house: d.in_house, working: d.working ?? d.works }));
      return { from, to, events, days };
    },
  };
}

function careNow(ctx0: ToolContext): AssistantTool {
  return {
    def: {
      name: "care_now",
      description:
        "The current state of the child's log: the latest entry of every kind (last feed, nap, diaper, medicine…) with when it was and when the next is due, anything still running (asleep, feeding), who has the child, and today's counts and entries. Cheapest first call for 'when did X last…', 'is the baby asleep', 'how many feeds today'.",
      input_schema: obj({ subject: SUBJECT_PROP(ctx0) }, ["subject"]),
    },
    run: async (input, ctx) => {
      const s = findSubject(ctx, input.subject);
      if (!s) return { error: "unknown_subject", known: ctx.subjects.map((x) => x.name) };
      const r = await rpc(ctx, "home_summary", { p_subject_id: s.id });
      if (!r.ok) return r;
      const last = Object.entries((r.last as Record<string, Record<string, unknown>>) ?? {}).map(([type, l]) => {
        const t = ctx.types.find((x) => x.id === type);
        entryRef(ctx, { id: l.id as string, type_label: t?.label, occurred_at: l.occurred_at as string }, s.module_id);
        return {
          id: l.id,
          type,
          label: t?.label ?? type,
          at: local(l.occurred_at as string, ctx.tz),
          ended: local(l.ended_at as string | null, ctx.tz),
          next_due: local(l.next_due as string | null, ctx.tz),
          details: l.payload,
          note: l.note ?? undefined,
          by: l.by,
        };
      });
      const custody = r.custody as Record<string, unknown> | null;
      return {
        subject: s.name,
        now: local(ctx.now.toISOString(), ctx.tz),
        who_has: custody ? `${custody.name} since ${local(custody.since as string, ctx.tz)}` : null,
        still_running: ((r.ongoing as Record<string, unknown>[]) ?? []).map((o) => ({ id: o.id, type: o.type_id, since: local(o.occurred_at as string, ctx.tz), details: o.payload })),
        latest_of_each_kind: last,
        today_counts: r.today_counts,
        today_entries: ((r.today_entries as Record<string, unknown>[]) ?? []).map((e) => trimEntry(ctx, e, s.module_id)),
      };
    },
  };
}

function careEntries(ctx0: ToolContext): AssistantTool {
  return {
    def: {
      name: "care_entries",
      description:
        "Every log entry for the child between two moments (feeds, sleeps, diapers, medicine, notes, appointments…), newest first. Use for a day, a night, or 'the last three feeds'. For 'last X' prefer care_now. Window: at most 14 days.",
      input_schema: obj(
        {
          subject: SUBJECT_PROP(ctx0),
          from: { type: "string", description: "Start, 'YYYY-MM-DD' (midnight) or 'YYYY-MM-DD HH:MM', household time." },
          to: { type: "string", description: "End (exclusive), same format. Omit for now." },
          type: { type: "string", description: "Optional: only this entry type id, e.g. lana.feed, lana.sleep." },
        },
        ["subject", "from"],
      ),
    },
    run: async (input, ctx) => {
      const s = findSubject(ctx, input.subject);
      if (!s) return { error: "unknown_subject", known: ctx.subjects.map((x) => x.name) };
      const from = parseWhen(input.from as string, ctx.tz, new Date(ctx.now.getTime() - 24 * 3600 * 1000));
      let to = input.to ? parseWhen(input.to as string, ctx.tz, ctx.now) : new Date(ctx.now.getTime() + 3600 * 1000).toISOString();
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(input.to ?? "").trim())) to = dayRange(String(input.to).trim(), ctx.tz).to; // a bare date as "to" means the whole day
      if (new Date(to).getTime() - new Date(from).getTime() > 14 * 24 * 3600 * 1000) to = new Date(new Date(from).getTime() + 14 * 24 * 3600 * 1000).toISOString();
      const r = await rpc(ctx, "care_entries_list", { p_subject_id: s.id, p_from: from, p_to: to });
      if (!r.ok) return r;
      let entries = (r.entries as Record<string, unknown>[]) ?? [];
      if (input.type) entries = entries.filter((e) => e.type_id === input.type);
      const total = entries.length;
      entries = entries.slice(0, 150);
      return { subject: s.name, from: local(from, ctx.tz), to: local(to, ctx.tz), total, shown: entries.length, entries: entries.map((e) => trimEntry(ctx, e, s.module_id)) };
    },
  };
}

function careStats(ctx0: ToolContext): AssistantTool {
  return {
    def: {
      name: "care_stats",
      description:
        "Daily totals for a child over a date range: feeds (breast count/minutes, left/right, bottles and ml, pumped), sleep (total, naps, night, longest stretch, night wake-ups, night feeds), diapers, weight/length/head, milestones. One row per day. Use for 'how did the baby sleep this week', 'is the baby drinking more than last week', trends. Up to 92 days.",
      input_schema: obj(
        {
          subject: SUBJECT_PROP(ctx0),
          from: { type: "string", description: "First day YYYY-MM-DD." },
          to: { type: "string", description: "Last day YYYY-MM-DD (inclusive)." },
        },
        ["subject", "from", "to"],
      ),
    },
    run: async (input, ctx) => {
      const s = findSubject(ctx, input.subject);
      if (!s) return { error: "unknown_subject", known: ctx.subjects.map((x) => x.name) };
      const from = String(input.from).slice(0, 10);
      let to = String(input.to ?? from).slice(0, 10);
      if (to > addDays(from, 92)) to = addDays(from, 92);
      const r = await rpc(ctx, "care_daily_stats", { p_subject_id: s.id, p_from: from, p_to: to });
      if (!r.ok) return r;
      return { subject: s.name, night: `${r.night_from}–${r.night_to}`, days: r.days };
    },
  };
}

function dueSoon(): AssistantTool {
  return {
    def: {
      name: "due_soon",
      description: "What is due or overdue: the next vaccination, a check-up, or anything else with a due date. Use for 'when is the next vaccination', 'is anything overdue'.",
      input_schema: obj({ days_ahead: { type: "integer", description: "How far ahead to look. Default 30." } }),
    },
    run: async (input, ctx) => {
      const r = await rpc(ctx, "care_due_list", { p_days_ahead: Number(input.days_ahead ?? 30) || 30 });
      if (!r.ok) return r;
      // A feed's "interval" row is the last start plus the type's fixed gap; it ignores how
      // long and how full the feed was and the gap for her age, so it would contradict Home.
      // The next feed comes from home_summary, already in the snapshot ("Next feed due").
      const items = ((r.items as Record<string, unknown>[]) ?? []).filter((d) => !(d.kind === "interval" && String(d.type_id ?? "").endsWith(".feed")));
      return {
        note: "The next feed is not listed here: use 'Next feed due' from the snapshot.",
        items: items.map((d) => {
          if (d.entry_id) ctx.refs[d.entry_id as string] = { href: `/${d.module_id}/entry/${d.entry_id}`, label: `${d.label}` };
          return { subject: d.subject, what: d.label, due: local(d.due_at as string, ctx.tz), overdue: d.overdue, entry_id: d.entry_id ?? undefined };
        }),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Proposals — nothing is written here. The UI shows a card; the member confirms.
// ---------------------------------------------------------------------------
function describeFields(fields: FieldDef[]): string {
  return fields
    .map((f) => {
      const bits: string[] = [f.type];
      if (f.options?.length) bits.push(`one of ${f.options.join(" | ")}`);
      if (f.quick?.length) bits.push(`usual ${f.quick.join("/")}`);
      if (f.required) bits.push("required");
      return `${f.key} (${bits.join(", ")})`;
    })
    .join("; ");
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function proposeCareEntry(ctx0: ToolContext): AssistantTool {
  const writable = ctx0.subjects.filter((s) => can(ctx0.me, s.module_id, "add"));
  const typeHelp = writable
    .map((s) => {
      const ts = ctx0.types.filter((t) => t.module_id === s.module_id);
      return `${s.name}: ${ts.map((t) => `${t.id} "${t.label}"${t.fields.length ? ` [${describeFields(t.fields)}]` : ""}${t.has_end ? " (has an end time)" : ""}`).join("; ")}`;
    })
    .join("\n");
  return {
    def: {
      name: "propose_care_entry",
      description: `Prepare a log entry for the member to confirm with one tap. Call this when asked to log, record or note something for ${writable.map((s) => s.name).join(" or ")}. Fill every required field from what was said; if a required field is missing or ambiguous, ask instead of calling. Times default to now; when the member says "at 3", "an hour ago" or "this morning", set occurred_at (and ended_at for a finished sleep or feed) from that, never now. To end something already running ("she woke up", "feed finished") use propose_end_timer instead. To fix or remove an entry already saved: propose_entry_change or propose_entry_delete. A dose of a medicine on the child's list: propose_medicine_dose. Who has the child: propose_custody. Milk into the fridge or freezer: propose_milk_add. Types and their fields:\n${typeHelp}`,
      input_schema: obj(
        {
          subject: { type: "string", description: `One of ${writable.map((s) => s.name).join(", ")}.` },
          type_id: { type: "string", description: "The entry type id, e.g. lana.feed." },
          occurred_at: { type: "string", description: "When it happened, 'YYYY-MM-DD HH:MM' household time. Omit for now." },
          ended_at: { type: "string", description: "When it ended, for sleeps and feeds with a known end. Omit if unknown or still going." },
          payload: { type: "object", description: "The type's fields as key → value, e.g. {\"method\":\"Bottle\",\"amount_ml\":120,\"milk\":\"Formula\"}." },
          note: { type: "string", description: "A short free-text note if the member said something worth keeping." },
          replaces_previous: { type: "boolean", description: "True when the member is correcting a card you showed that is not confirmed yet (\"make it 90\", \"no, it was dirty\"): this card takes its place." },
        },
        ["subject", "type_id", "payload"],
      ),
    },
    run: async (input, ctx) => {
      const s = findSubject(ctx, input.subject);
      if (!s || !can(ctx.me, s.module_id, "add")) return { error: "not_allowed", message: "You cannot log for that subject." };
      const t = ctx.types.find((x) => x.id === input.type_id && x.module_id === s.module_id);
      if (!t) return { error: "bad_type", known: ctx.types.filter((x) => x.module_id === s.module_id).map((x) => x.id) };
      const payload = (input.payload && typeof input.payload === "object" ? input.payload : {}) as Record<string, unknown>;
      const missingFields = t.fields.filter((f) => f.required && (payload[f.key] === undefined || payload[f.key] === ""));
      if (missingFields.length) {
        const f = missingFields[0];
        const offer = f.options?.length ? f.options : f.quick?.length ? f.quick.map((n) => `${n}${f.key.endsWith("_ml") ? " ml" : f.key.endsWith("_g") ? " g" : ""}`) : null;
        return {
          error: "missing_fields",
          missing: missingFields.map((x) => x.key),
          ask: { field: f.key, label: f.label, options: offer },
          message: offer ? "Ask with ask_choice, these options as the answers (one short question), then propose once answered." : "Ask the member for this in one short question, then propose.",
        };
      }
      const bad = t.fields.filter((f) => f.options?.length && payload[f.key] !== undefined && !f.options.includes(String(payload[f.key]))).map((f) => ({ field: f.key, options: f.options }));
      if (bad.length) return { error: "bad_option", bad };
      const o = whenGiven(input.occurred_at, ctx);
      if ("error" in o) return o;
      const occurred = o.at;
      let ended: string | null = null;
      if (input.ended_at !== undefined && input.ended_at !== null && String(input.ended_at).trim() !== "") {
        const e = whenGiven(input.ended_at, ctx);
        if ("error" in e) return e;
        ended = e.at;
      }
      if (ended && new Date(ended) < new Date(occurred)) return { error: "end_before_start" };
      const details = Object.entries(payload)
        .filter(([, v]) => v !== null && v !== "" && v !== undefined)
        .map(([k, v]) => (k === "amount_ml" ? `${v} ml` : k === "amount_g" ? `${v} g` : k === "duration_min" ? `${v} min` : String(v)))
        .join(", ");
      const p: AssistantProposal = {
        id: newId(),
        kind: "care_entry",
        summary: `${t.icon ?? ""} ${t.label}${details ? ` · ${details}` : ""} · ${s.name} · ${local(occurred, ctx.tz)}${ended ? ` → ${local(ended, ctx.tz)?.slice(11)}` : ""}`.trim(),
        care_entry: { subject_id: s.id, subject_name: s.name, module_id: s.module_id, type_id: t.id, type_label: t.label, occurred_at: occurred, ended_at: ended, payload, note: (input.note as string) || null },
        ...(input.replaces_previous === true ? { replaces: true } : {}),
      };
      ctx.proposals.push(p);
      return { ok: true, proposal_id: p.id, shown_as: p.summary, next: "Tell the member to tap Confirm. It is NOT saved yet." };
    },
  };
}

/**
 * One question with its answers as buttons (Mido, 8 November: "was it a wet nappy?" with a
 * tap, not typing). The member's tap comes back as their next message.
 */
function askChoice(): AssistantTool {
  return {
    def: {
      name: "ask_choice",
      description: "Ask the member one short question whose answer is one of a few options, shown as buttons they tap: which kind of nappy (Wet | Dirty | Both), which breast side (Left | Right), a bottle size (60 ml | 90 ml | 120 ml | 150 ml), whether a time was when she fell asleep or woke up. Use it instead of a typed question whenever the answer is one of 2 to 6 short options; write the same question as your answer, in one line. One per answer.",
      input_schema: obj(
        {
          question: { type: "string", description: "The question, short, e.g. \"Wet, dirty or both?\"" },
          options: { type: "array", items: { type: "string" }, description: "2 to 6 answers, each a few words, in the member's language." },
        },
        ["question", "options"],
      ),
    },
    run: async (input, ctx) => {
      const question = String(input.question ?? "").trim().slice(0, 140);
      const options = (Array.isArray(input.options) ? input.options : []).map((o) => String(o).trim().slice(0, 30)).filter(Boolean);
      const unique = [...new Set(options)];
      if (!question || unique.length < 2 || unique.length > 6) return { error: "bad_choice", message: "Give one question and 2 to 6 short options." };
      if (ctx.choice) return { error: "one_question", message: "One question per answer: ask the other after this one is answered." };
      ctx.choice = { question, options: unique };
      return { ok: true, next: "Write the question as your answer, one short line. Do not propose anything until it is answered." };
    },
  };
}

function proposeEndTimer(ctx0: ToolContext): AssistantTool {
  const writable = ctx0.subjects.filter((s) => can(ctx0.me, s.module_id, "add"));
  const timers = ctx0.types.filter((t) => t.has_end && writable.some((s) => s.module_id === t.module_id)).map((t) => `${t.id} "${t.label}"`);
  return {
    def: {
      name: "propose_end_timer",
      description: `End something still running, for the member to confirm with one tap: "she woke up", "she's up", "feed finished", "night wake over". Finds the running timer itself; call this, not propose_care_entry, when the thing already started. It ends now unless the member said when ("she woke at 6:40"). Subjects: ${writable.map((s) => s.name).join(", ")}. Timers: ${timers.join("; ")}.`,
      input_schema: obj(
        {
          subject: { type: "string", description: `One of ${writable.map((s) => s.name).join(", ")}.` },
          type_id: { type: "string", description: "Which timer, e.g. lana.sleep. Omit to end whatever is running when only one thing is." },
          ended_at: { type: "string", description: "When it ended, 'YYYY-MM-DD HH:MM' household time. Omit for now." },
          replaces_previous: { type: "boolean", description: "True when the member is correcting an end card you showed that is not confirmed yet (\"no, she woke at 6:40\")." },
        },
        ["subject"],
      ),
    },
    run: async (input, ctx) => {
      const s = findSubject(ctx, input.subject);
      if (!s || !can(ctx.me, s.module_id, "add")) return { error: "not_allowed", message: "You cannot log for that subject." };
      const r = await rpc(ctx, "home_summary", { p_subject_id: s.id });
      if (!r.ok) return r;
      const running = ((r.ongoing as { id: string; type_id: string; occurred_at: string; payload?: Record<string, unknown> }[]) ?? []).filter((o) => o.id && o.type_id && o.occurred_at);
      const wanted = input.type_id ? running.filter((o) => o.type_id === input.type_id) : running;
      if (!wanted.length) {
        return { error: "nothing_running", running: running.map((o) => o.type_id), message: "Nothing of that kind is running now. If it did happen, propose_care_entry with its start and end; otherwise tell the member." };
      }
      if (wanted.length > 1) return { error: "ambiguous", running: wanted.map((o) => ({ type_id: o.type_id, since: local(o.occurred_at, ctx.tz) })), message: "More than one thing is running: ask which, then call again with type_id." };
      const o = wanted[0];
      const e = whenGiven(input.ended_at, ctx);
      if ("error" in e) return e;
      if (new Date(e.at) < new Date(o.occurred_at)) return { error: "end_before_start", started: local(o.occurred_at, ctx.tz), message: "That end is before it started; ask the member again." };
      const t = ctx.types.find((x) => x.id === o.type_id);
      const label = t?.label ?? o.type_id;
      const p: AssistantProposal = {
        id: newId(),
        kind: "end_timer",
        summary: `${t?.icon ?? ""} ${label} ended · ${s.name} · ${local(o.occurred_at, ctx.tz)} → ${local(e.at, ctx.tz)?.slice(11)}`.trim(),
        end_timer: { entry_id: o.id, subject_name: s.name, type_id: o.type_id, type_label: label, since: o.occurred_at, ended_at: e.at },
        ...(input.replaces_previous === true ? { replaces: true } : {}),
      };
      ctx.proposals.push(p);
      return { ok: true, proposal_id: p.id, shown_as: p.summary, next: "Tell the member to tap Confirm. It is NOT ended yet." };
    },
  };
}

function proposeCalendarEvent(): AssistantTool {
  return {
    def: {
      name: "propose_calendar_event",
      description: `Prepare a calendar entry for the member to confirm with one tap: an event, plan, reminder, guest day, delivery, contractor visit or appointment. Kinds: ${EVENT_KINDS.map((k) => k.id).join(", ")}.`,
      input_schema: obj(
        {
          title: { type: "string" },
          kind: { type: "string", description: EVENT_KINDS.map((k) => k.id).join(" | ") },
          starts_at: { type: "string", description: "'YYYY-MM-DD HH:MM' household time, or 'YYYY-MM-DD' for an all-day entry." },
          ends_at: { type: "string", description: "Optional end, same format." },
          note: { type: "string" },
        },
        ["title", "kind", "starts_at"],
      ),
    },
    run: async (input, ctx) => {
      const kind = EVENT_KINDS.find((k) => k.id === input.kind)?.id ?? ("event" as EventKind);
      const allDay = /^\d{4}-\d{2}-\d{2}$/.test(String(input.starts_at).trim());
      const st = whenGiven(input.starts_at, ctx);
      if ("error" in st) return st;
      const starts = st.at;
      let ends: string | null = null;
      if (input.ends_at !== undefined && input.ends_at !== null && String(input.ends_at).trim() !== "") {
        const en = whenGiven(input.ends_at, ctx);
        if ("error" in en) return en;
        ends = en.at;
      }
      if (ends && new Date(ends) < new Date(starts)) return { error: "end_before_start" };
      const title = String(input.title ?? "").trim();
      if (!title) return { error: "no_title" };
      const p: AssistantProposal = {
        id: newId(),
        kind: "calendar_event",
        summary: `${EVENT_KINDS.find((k) => k.id === kind)?.icon ?? "📌"} ${title} · ${allDay ? local(starts, ctx.tz)?.slice(0, 10) : local(starts, ctx.tz)}${ends ? ` → ${local(ends, ctx.tz)?.slice(11)}` : ""}`,
        calendar_event: { title, kind, starts_at: starts, ends_at: ends, all_day: allDay, note: (input.note as string) || null },
      };
      ctx.proposals.push(p);
      return { ok: true, proposal_id: p.id, shown_as: p.summary, next: "Tell the member to tap Confirm. It is NOT saved yet." };
    },
  };
}

function coachPlan(ctx0: ToolContext): AssistantTool {
  return {
    def: {
      name: "coach_plan",
      description: "The family's active coach plan for a child (goal, day-by-day steps, which day it is, which days were ticked done). Call before suggesting a new plan or when asked how the plan is going.",
      input_schema: obj({ subject: SUBJECT_PROP(ctx0) }),
    },
    run: async (input, ctx) => {
      const s = findSubject(ctx, input.subject);
      if (!s || s.kind !== "child") return { error: "unknown_subject" };
      return rpc(ctx, "coach_plan_active", { p_subject_id: s.id });
    },
  };
}

function sleepRhythm(ctx0: ToolContext): AssistantTool {
  return {
    def: {
      name: "sleep_rhythm",
      description: "A child's sleep rhythm from the last 14 days: usual nap length, the awake window before the longest naps, usual bedtime, naps counted, plus the typical awake window for the child's age. Use for nap, bedtime and night-waking questions before giving advice.",
      input_schema: obj({ subject: SUBJECT_PROP(ctx0) }),
    },
    run: async (input, ctx) => {
      const s = findSubject(ctx, input.subject);
      if (!s || s.kind !== "child") return { error: "unknown_subject" };
      const r = await rpc(ctx, "care_entries_list", { p_subject_id: s.id, p_from: new Date(ctx.now.getTime() - 14 * 86_400_000).toISOString(), p_to: ctx.now.toISOString() });
      if (!r.ok) return r;
      const entries = ((r.entries as EntryRow[]) ?? []).filter((e) => e.type_id.endsWith(".sleep"));
      const ageDays = ageInDays(s.birth_date, ctx.now.getTime(), ctx.tz) ?? 120;
      const hourOf = (iso: string) => {
        const parts = new Intl.DateTimeFormat("en-GB", { timeZone: ctx.tz, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date(iso));
        return Number(parts.find((p) => p.type === "hour")?.value ?? 0) + Number(parts.find((p) => p.type === "minute")?.value ?? 0) / 60;
      };
      const c = sleepCoach(entries, ageDays, hourOf);
      const [lo, hi] = awakeWindow(ageDays);
      return { subject: s.name, age_days: ageDays, typical_awake_window_min: `${lo} to ${hi}`, sleeps_logged: entries.length, rhythm: c ?? "not enough sleeps with an end time yet (need 6)" };
    },
  };
}

function ageDaysOf(ctx: ToolContext, s: SubjectInfo): number {
  return ageInDays(s.birth_date, ctx.now.getTime(), ctx.tz) ?? 120;
}

function ageOutlookTool(ctx0: ToolContext): AssistantTool {
  return {
    def: {
      name: "age_outlook",
      description: "Which developmental phases a child is in now and which come next (growth spurts, the 4-month sleep change, teething, solids, nap changes), with day counts and the typical awake window. Use for 'is this a regression', 'when do teeth come', 'is the baby ready for solids'.",
      input_schema: obj({ subject: SUBJECT_PROP(ctx0) }),
    },
    run: async (input, ctx) => {
      const s = findSubject(ctx, input.subject);
      if (!s || s.kind !== "child") return { error: "unknown_subject" };
      const w = leapWeek(ageDaysOf(ctx, s));
      return { subject: s.name, ...ageOutlook(ageDaysOf(ctx, s)), week: w ? { week: w.week, stretch: w.band.title, expect: w.band.expect, often_harder: w.band.tough, tip: w.band.tip, next_stretch: w.next?.title ?? null, weeks_to_next: w.weeksToNext } : null };
    },
  };
}

function dayScheduleTool(ctx0: ToolContext): AssistantTool {
  return {
    def: {
      name: "day_schedule",
      description: "A gentle day rhythm (naps, feeds, bedtime) from a morning wake time, using the child's best recent awake window when the log shows one, else the age norm. A guide, not a timetable. Use when asked 'what should the day look like' or to plan naps around the breastfeeding parent's hours.",
      input_schema: obj({ subject: SUBJECT_PROP(ctx0), wake_time: { type: "string", description: "HH:MM household time the child woke up or usually wakes." } }, ["wake_time"]),
    },
    run: async (input, ctx) => {
      const s = findSubject(ctx, input.subject);
      if (!s || s.kind !== "child") return { error: "unknown_subject" };
      const m = /^(\d{1,2}):(\d{2})$/.exec(String(input.wake_time ?? "").trim());
      if (!m) return { error: "bad_time", message: "wake_time as HH:MM" };
      const r = await rpc(ctx, "care_entries_list", { p_subject_id: s.id, p_from: new Date(ctx.now.getTime() - 14 * 86_400_000).toISOString(), p_to: ctx.now.toISOString() });
      const entries = r.ok ? (((r.entries as EntryRow[]) ?? []).filter((e) => e.type_id.endsWith(".sleep"))) : [];
      const hourOf = (iso: string) => {
        const parts = new Intl.DateTimeFormat("en-GB", { timeZone: ctx.tz, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date(iso));
        return Number(parts.find((p) => p.type === "hour")?.value ?? 0) + Number(parts.find((p) => p.type === "minute")?.value ?? 0) / 60;
      };
      const ageDays = ageDaysOf(ctx, s);
      const coach = sleepCoach(entries, ageDays, hourOf);
      const sched = daySchedule(Number(m[1]) * 60 + Number(m[2]), ageDays, coach?.bestWindowMin ?? null);
      const away = ctx.routines.length ? "The breastfeeding parent's work hours are in the routines above; bottles every 2 h while they are away." : undefined;
      return { subject: s.name, ...sched, note: away };
    },
  };
}

function redFlagCheck(ctx0: ToolContext): AssistantTool {
  return {
    def: {
      name: "red_flag_check",
      description: "Scan the last 1 to 3 days of a child's log for warning signs: few wet nappies, few feeds, long gaps, long awake stretches, little sleep. Returns the same red and yellow flags as the app's guide. Run it whenever the question mentions illness, feeding refusal, fewer nappies or unusual sleepiness. Any red flag means: contact the paediatrician.",
      input_schema: obj({ subject: SUBJECT_PROP(ctx0), days: { type: "integer", description: "1 to 3" } }),
    },
    run: async (input, ctx) => {
      const s = findSubject(ctx, input.subject);
      if (!s || s.kind !== "child") return { error: "unknown_subject" };
      const d = Math.min(3, Math.max(1, Math.round(Number(input.days) || 1)));
      const r = await rpc(ctx, "care_entries_list", { p_subject_id: s.id, p_from: new Date(ctx.now.getTime() - (d + 6) * 86_400_000).toISOString(), p_to: ctx.now.toISOString() });
      if (!r.ok) return r;
      const entries = ((r.entries as EntryRow[]) ?? []);
      const flags = tipsFor(entries, s.birth_date, ctx.now.getTime(), { timezone: ctx.tz, feedGapMin: ctx.types.find((t) => t.id === `${s.module_id}.feed`)?.due_after_min ?? 180, name: s.name, sex: s.sex }).filter((t) => t.level !== "info");
      const fever = entries.filter((e) => Number(e.payload.temp_c ?? e.payload.temperature) >= 38).map((e) => `temperature ${e.payload.temp_c ?? e.payload.temperature} °C at ${local(e.occurred_at, ctx.tz)}`);
      return { subject: s.name, days: d, entries: entries.length, flags: [...flags.map((t) => ({ level: t.level, title: t.title, detail: t.body })), ...fever.map((f) => ({ level: "red", title: f }))], ok: flags.length === 0 && fever.length === 0, note: entries.length <= 5 ? "Too little logged to judge." : undefined };
    },
  };
}

function planHistory(ctx0: ToolContext): AssistantTool {
  return {
    def: {
      name: "plan_history",
      description: "Past coach plans for a child: goal, dates, status, how many days were ticked done, and the check-in notes. Use before proposing a plan, so a plan that failed is not offered again unchanged.",
      input_schema: obj({ subject: SUBJECT_PROP(ctx0) }),
    },
    run: async (input, ctx) => {
      const s = findSubject(ctx, input.subject);
      if (!s || s.kind !== "child") return { error: "unknown_subject" };
      return rpc(ctx, "coach_plan_history", { p_subject_id: s.id, p_limit: 8 });
    },
  };
}

function recentChats(): AssistantTool {
  return {
    def: {
      name: "recent_chats",
      description: "The member's last few saved chats with you: title, date and the last question and answer. Use to pick up where an earlier chat left off ('last time we talked about the naps').",
      input_schema: obj({}),
    },
    run: async (_input, ctx) => {
      const { data } = await ctx.supabase.from("ask_chats").select("title, updated_at, messages").order("updated_at", { ascending: false }).limit(4);
      type M = { role?: string; text?: string };
      return {
        chats: ((data as { title: string; updated_at: string; messages: M[] }[] | null) ?? []).map((c) => {
          const ms = (Array.isArray(c.messages) ? c.messages : []).filter((m) => m && typeof m.text === "string");
          const lastQ = [...ms].reverse().find((m) => m.role === "user")?.text?.slice(0, 200) ?? null;
          const lastA = [...ms].reverse().find((m) => m.role === "assistant")?.text?.slice(0, 300) ?? null;
          return { title: c.title, on: c.updated_at.slice(0, 10), last_question: lastQ, last_answer: lastA };
        }),
      };
    },
  };
}

function proposePlan(ctx0: ToolContext): AssistantTool {
  const kids = ctx0.subjects.filter((s) => s.kind === "child" && can(ctx0.me, s.module_id, "add"));
  return {
    def: {
      name: "propose_plan",
      description: `Offer a short day-by-day coach plan (1 to 14 days, usually 5 to 7) for ${kids.map((s) => s.name).join(" or ")}: one small change, one clear step per day. The family sees it as a card and taps Start; nothing is saved until then. Introduce it briefly in words; do not repeat the steps in text.`,
      input_schema: obj(
        {
          subject: { type: "string", description: `One of ${kids.map((s) => s.name).join(", ")}.` },
          goal: { type: "string", description: "Short goal, e.g. 'Earlier, calmer bedtime'." },
          steps: { type: "array", description: "One step per day, in order.", items: { type: "object", properties: { day: { type: "integer" }, step: { type: "string" } }, required: ["day", "step"] } },
        },
        ["subject", "goal", "steps"],
      ),
    },
    run: async (input, ctx) => {
      const s = findSubject(ctx, input.subject);
      if (!s || !can(ctx.me, s.module_id, "add")) return { error: "not_allowed" };
      const goal = String(input.goal ?? "").trim().slice(0, 120);
      const raw = Array.isArray(input.steps) ? (input.steps as { day?: unknown; step?: unknown }[]) : [];
      const steps = raw.map((x, i) => ({ day: i + 1, step: String(x?.step ?? "").trim().slice(0, 300) })).filter((x) => x.step);
      if (!goal || steps.length < 1 || steps.length > 14) return { error: "bad_plan", message: "A goal and 1 to 14 steps." };
      const p: AssistantProposal = { id: newId(), kind: "plan", summary: `${steps.length}-day plan · ${goal} · ${s.name}`, plan: { subject_id: s.id, subject_name: s.name, goal, steps } };
      ctx.proposals.push(p);
      return { ok: true, proposal_id: p.id, shown_as: p.summary, next: "Tell the member to tap Start. It is NOT saved yet." };
    },
  };
}

function forgetMemory(): AssistantTool {
  return {
    def: {
      name: "forget_memory",
      description: "Prepare to drop a remembered fact that the member says is wrong or out of date. The member confirms with a tap. Use the id from the list of remembered things.",
      input_schema: obj({ id: { type: "string", description: "The memory id (the 8 characters in brackets are enough)." } }, ["id"]),
    },
    run: async (input, ctx) => {
      const key = String(input.id ?? "").trim().toLowerCase();
      const f = ctx.facts.find((x) => x.id === key || x.id.startsWith(key));
      if (!key || !f) return { error: "unknown_memory", known: ctx.facts.map((x) => `${x.id.slice(0, 8)}: ${x.body}`) };
      const p: AssistantProposal = { id: newId(), kind: "forget", summary: `Forget: ${f.body}`, forget: { id: f.id, body: f.body } };
      ctx.proposals.push(p);
      return { ok: true, proposal_id: p.id, shown_as: p.summary, next: "Tell the member to tap Confirm. It is NOT forgotten yet." };
    },
  };
}

function remember(): AssistantTool {
  return {
    def: {
      name: "propose_memory",
      description: "Prepare a short fact for the household helper to keep for everyone, after the member confirms: preferences, what works for the child, how someone likes answers. Call this when the member says 'remember that…', 'keep in mind…', 'from now on…'. One plain sentence, under 300 characters, no times or amounts that belong in the log. Never for something another propose tool saves: who has the child (propose_custody), a log entry, milk, a medicine dose or a vaccine.",
      input_schema: obj({ body: { type: "string", description: "The fact, as one plain sentence." } }, ["body"]),
    },
    run: async (input, ctx) => {
      const body = String(input.body ?? "").trim();
      if (body.length < 2 || body.length > 300) return { error: "bad_body", message: "One sentence, under 300 characters." };
      if (ctx.facts.some((m) => m.status !== "suggested" && m.body.toLowerCase() === body.toLowerCase())) return { ok: true, already: true, message: "Already remembered." };
      const p: AssistantProposal = { id: newId(), kind: "memory", summary: `Remember: ${body}`, memory: { body } };
      ctx.proposals.push(p);
      return { ok: true, proposal_id: p.id, shown_as: p.summary, next: "Tell the member to tap Confirm. It is NOT saved yet." };
    },
  };
}

// ---------------------------------------------------------------------------
// Everything else about the child the screens can write (Mido, 13 November: "I should be able
// to tell the helper anything related to Lana and log it with my confirmation"). Each is a card
// the member confirms; the card calls the same RPC as the screen, as that member.
// ---------------------------------------------------------------------------

/** "120 ml, Bottle" from an entry's payload, as the cards say it. */
function detailWords(payload: Record<string, unknown>): string {
  return Object.entries(payload)
    .filter(([k, v]) => v !== null && v !== "" && v !== undefined && !["auto_end", "checked", "medicine_id", "early", "client_id"].includes(k))
    .map(([k, v]) => (k === "amount_ml" ? `${v} ml` : k === "amount_g" ? `${v} g` : k === "duration_min" ? `${v} min` : typeof v === "boolean" ? (v ? k.replace(/_/g, " ") : "") : String(v)))
    .filter(Boolean)
    .join(", ");
}

/** One entry in words: "Bottle, 120 ml · 07:10 → 07:30", for the before and after of a change. */
function entryWords(e: { occurred_at: string; ended_at: string | null; payload: Record<string, unknown>; note?: string | null }, tz: string): string {
  const d = detailWords(e.payload);
  const span = `${local(e.occurred_at, tz)?.slice(11)}${e.ended_at ? ` → ${local(e.ended_at, tz)?.slice(11)}` : ""}`;
  return [d, span, e.note ? `“${e.note}”` : ""].filter(Boolean).join(" · ");
}

type EntryRowLite = { id: string; subject_id: string; type_id: string; occurred_at: string; ended_at: string | null; payload: Record<string, unknown> | null; note: string | null };

/** A saved entry by the id a read tool gave (care_now, care_entries); RLS decides whether it is visible. */
async function entryById(ctx: ToolContext, raw: unknown): Promise<{ e: EntryRowLite; s: SubjectInfo; t: EntryType | undefined } | { error: string; message: string }> {
  const id = String(raw ?? "").trim().replace(/^entry:/, "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return { error: "bad_id", message: "Give the entry's full id, as care_now or care_entries returned it. Look the entry up first." };
  const q = ctx.supabase.from("care_entries").select("id,subject_id,type_id,occurred_at,ended_at,payload,note").eq("id", id).is("deleted_at", null);
  const { data, error } = await (ctx.signal ? q.abortSignal(ctx.signal) : q).maybeSingle();
  if (error) return { error: "rpc_failed", message: error.message };
  const e = data as EntryRowLite | null;
  if (!e) return { error: "not_found", message: "No such entry (it may have been deleted). Look it up again with care_entries." };
  const s = ctx.subjects.find((x) => x.id === e.subject_id);
  if (!s) return { error: "not_found", message: "That entry is not one you can see." };
  return { e: { ...e, payload: e.payload ?? {} }, s, t: ctx.types.find((x) => x.id === e.type_id) };
}

function proposeCustody(ctx0: ToolContext): AssistantTool {
  const writable = ctx0.subjects.filter((s) => can(ctx0.me, s.module_id, "add"));
  return {
    def: {
      name: "propose_custody",
      description: `Say who has ${writable.map((s) => s.name).join(" or ")} from now on, for the member to confirm with one tap: "Wafa has Lana now", "I'm taking her", "Dana has her", "handing her to Lilly". This is what the Home header shows ("with Wafa") and who later entries are put down to. People: ${ctx0.people.map((p) => p.name).join(", ")}.`,
      input_schema: obj(
        {
          member: { type: "string", description: "Who has the child now: a first name, or \"me\" for the person talking." },
          subject: { type: "string", description: `One of ${writable.map((s) => s.name).join(", ")}. Omit when there is one.` },
          replaces_previous: { type: "boolean", description: "True when correcting a card not confirmed yet (\"no, Lilly has her\")." },
        },
        ["member"],
      ),
    },
    run: async (input, ctx) => {
      const s = findSubject(ctx, input.subject);
      if (!s || !can(ctx.me, s.module_id, "add")) return { error: "not_allowed", message: "You cannot change who has that child." };
      const m = matchMember(ctx.people, input.member, ctx.me.member.id);
      if (!m.ok) return { error: m.error === "ambiguous" ? "ambiguous_member" : "unknown_member", options: m.options.map((p) => p.name), message: m.error === "ambiguous" ? "More than one person fits: ask which with ask_choice." : "Nobody of that name in the house: ask who, with the names as options." };
      const r = await rpc(ctx, "home_summary", { p_subject_id: s.id });
      const custody = r.ok ? (r.custody as { name?: string; since?: string } | null) : null;
      if (custody?.name === m.item.name) return { ok: true, already: true, message: `${m.item.name} already has ${s.name}, since ${local(custody.since ?? null, ctx.tz)}. Nothing to change: say so in one line.` };
      const p: AssistantProposal = {
        id: newId(),
        kind: "custody",
        summary: `👐 ${m.item.name} has ${s.name} · from ${local(ctx.now.toISOString(), ctx.tz)?.slice(11)}${custody?.name ? ` (was ${custody.name})` : ""}`,
        custody: { subject_id: s.id, subject_name: s.name, member_id: m.item.id, member_name: m.item.name },
        ...(input.replaces_previous === true ? { replaces: true } : {}),
      };
      ctx.proposals.push(p);
      return { ok: true, proposal_id: p.id, shown_as: p.summary, next: "Tell the member to tap Confirm. It is NOT changed yet." };
    },
  };
}

function proposeEntryChange(ctx0: ToolContext): AssistantTool {
  const editable = ctx0.subjects.filter((s) => can(ctx0.me, s.module_id, "edit"));
  return {
    def: {
      name: "propose_entry_change",
      description: `Fix an entry already saved in ${editable.map((s) => s.name).join(" or ")}'s log, for the member to confirm with one tap: "that bottle was 90 not 120", "she actually woke at 6:40", "it was a dirty nappy", "the nap started at 1, not 1:30", "she's still asleep" (clears the end). Find the entry first with care_now or care_entries and pass its id. Only what was said changes; the rest stays. Not for a card that is not confirmed yet (propose it again with replaces_previous).`,
      input_schema: obj(
        {
          entry_id: { type: "string", description: "The entry's full id from care_now or care_entries." },
          occurred_at: { type: "string", description: "New start, 'YYYY-MM-DD HH:MM' household time. Omit to keep." },
          ended_at: { type: "string", description: "New end, same format. Omit to keep." },
          clear_end: { type: "boolean", description: "True when the thing is still going after all (\"she's still asleep\"): the end is removed." },
          payload: { type: "object", description: "Only the fields that change, e.g. {\"amount_ml\":90} or {\"kind\":\"Dirty\"}. A field set to null is removed." },
          note: { type: "string", description: "A new note, replacing the old one. Omit to keep; empty to clear." },
          replaces_previous: { type: "boolean", description: "True when correcting a change card not confirmed yet." },
        },
        ["entry_id"],
      ),
    },
    run: async (input, ctx) => {
      const found = await entryById(ctx, input.entry_id);
      if ("error" in found) return found;
      const { e, s, t } = found;
      if (!can(ctx.me, s.module_id, "edit")) return { error: "not_allowed", message: "You cannot change entries for that child: ask an admin." };
      const changes = (input.payload && typeof input.payload === "object" ? input.payload : {}) as Record<string, unknown>;
      const bad = (t?.fields ?? []).filter((f) => f.options?.length && changes[f.key] !== undefined && changes[f.key] !== null && !f.options.includes(String(changes[f.key]))).map((f) => ({ field: f.key, options: f.options }));
      if (bad.length) return { error: "bad_option", bad };
      const unknownKeys = Object.keys(changes).filter((k) => t && t.fields.length && !t.fields.some((f) => f.key === k));
      if (unknownKeys.length) return { error: "bad_field", unknown: unknownKeys, fields: t?.fields.map((f) => f.key) };
      let occurred: string | undefined;
      if (input.occurred_at !== undefined && input.occurred_at !== null && String(input.occurred_at).trim() !== "") {
        const o = whenGiven(input.occurred_at, ctx);
        if ("error" in o) return o;
        occurred = o.at;
      }
      let ended: string | "" | undefined;
      if (input.clear_end === true) ended = "";
      else if (input.ended_at !== undefined && input.ended_at !== null && String(input.ended_at).trim() !== "") {
        const x = whenGiven(input.ended_at, ctx);
        if ("error" in x) return x;
        ended = x.at;
      }
      const note = input.note === undefined || input.note === null ? undefined : String(input.note);
      const m = mergeEntry({ occurred_at: e.occurred_at, ended_at: e.ended_at, payload: e.payload ?? {}, note: e.note }, { occurred_at: occurred, ended_at: ended, payload: changes, note });
      if (!m.ok) return m.error === "end_before_start" ? { error: "end_before_start", message: "That end is before the start: ask the member again." } : { error: "nothing_changed", message: "That is what the entry already says: tell the member nothing needs changing." };
      const label = t?.label ?? e.type_id;
      const before = entryWords({ ...e, payload: e.payload ?? {} }, ctx.tz);
      const after = entryWords(m.next, ctx.tz);
      const p: AssistantProposal = {
        id: newId(),
        kind: "entry_change",
        summary: `✏️ ${label} · ${after} (was ${before})`,
        entry_change: { entry_id: e.id, subject_name: s.name, type_id: e.type_id, type_label: label, ...m.next, before, after },
        ...(input.replaces_previous === true ? { replaces: true } : {}),
      };
      entryRef(ctx, { id: e.id, type_label: label, occurred_at: e.occurred_at }, s.module_id);
      ctx.proposals.push(p);
      return { ok: true, proposal_id: p.id, shown_as: p.summary, changed: m.changed, next: "Tell the member to tap Confirm. It is NOT changed yet." };
    },
  };
}

function proposeEntryDelete(ctx0: ToolContext): AssistantTool {
  const deletable = ctx0.subjects.filter((s) => can(ctx0.me, s.module_id, "delete"));
  return {
    def: {
      name: "propose_entry_delete",
      description: `Delete an entry already saved in ${deletable.map((s) => s.name).join(" or ")}'s log, for the member to confirm with one tap: "delete the last nappy, it was a mistake", "that bottle was logged twice, remove one". Find it first with care_now or care_entries and pass its id. When it was logged twice, delete the later one. Only when the member asks for it gone; to fix a time or amount use propose_entry_change.`,
      input_schema: obj({ entry_id: { type: "string", description: "The entry's full id from care_now or care_entries." } }, ["entry_id"]),
    },
    run: async (input, ctx) => {
      const found = await entryById(ctx, input.entry_id);
      if ("error" in found) return found;
      const { e, s, t } = found;
      if (!can(ctx.me, s.module_id, "delete")) return { error: "not_allowed", message: "You cannot delete entries for that child: ask an admin." };
      const label = t?.label ?? e.type_id;
      const what = entryWords({ ...e, payload: e.payload ?? {} }, ctx.tz);
      const p: AssistantProposal = {
        id: newId(),
        kind: "entry_delete",
        summary: `🗑️ Delete · ${label} · ${what}`,
        entry_delete: { entry_id: e.id, subject_name: s.name, type_id: e.type_id, type_label: label, occurred_at: e.occurred_at, what },
      };
      entryRef(ctx, { id: e.id, type_label: label, occurred_at: e.occurred_at }, s.module_id);
      ctx.proposals.push(p);
      return { ok: true, proposal_id: p.id, shown_as: p.summary, next: "Tell the member to tap Delete to remove it. It is NOT deleted yet." };
    },
  };
}

function milkStash(): AssistantTool {
  return {
    def: {
      name: "milk_stash",
      description: "The breast milk stash: every bottle or bag in the fridge and freezer (id, ml, when pumped, when it expires, thawed or warmed) and the totals. Use for 'how much milk is in the freezer', 'which bottle goes first', and before moving a bottle.",
      input_schema: obj({}),
    },
    run: async (_input, ctx) => {
      const r = await rpc(ctx, "milk_list", {});
      if (!r.ok) return r;
      const bottles = ((r.bottles as Record<string, unknown>[]) ?? []).map((b) => ({
        id: String(b.id).slice(0, 8),
        ml: b.amount_ml,
        where: b.location,
        pumped: local(b.pumped_at as string, ctx.tz),
        use_by: local(b.expires_at as string, ctx.tz),
        ...(b.expired ? { expired: true } : {}),
        ...(b.thawed_at ? { thawed: local(b.thawed_at as string, ctx.tz) } : {}),
        ...(b.warmed_at ? { warmed: local(b.warmed_at as string, ctx.tz) } : {}),
      }));
      return { fridge_ml: r.fridge_ml, fridge_bottles: r.fridge_count, freezer_ml: r.freezer_ml, freezer_bottles: r.freezer_count, note: "Totals leave out expired bottles. Use first: the earliest use_by.", bottles };
    },
  };
}

function proposeMilkAdd(): AssistantTool {
  return {
    def: {
      name: "propose_milk_add",
      description: "Put a bottle or bag of breast milk in the stash, for the member to confirm with one tap: \"put 120 ml in the freezer\", \"pumped 150, it's in the fridge\". One call per bottle. A pump logged in the log does not add milk to the stash by itself: when the member says where the milk went, propose this too. If they did not say fridge or freezer, ask with ask_choice (Fridge | Freezer).",
      input_schema: obj(
        {
          amount_ml: { type: "integer", description: "Millilitres in this bottle or bag." },
          location: { type: "string", description: "fridge | freezer" },
          pumped_at: { type: "string", description: "When it was pumped, 'YYYY-MM-DD HH:MM' household time. Omit for now." },
          note: { type: "string" },
        },
        ["amount_ml", "location"],
      ),
    },
    run: async (input, ctx) => {
      const ml = Math.round(Number(input.amount_ml));
      if (!Number.isFinite(ml) || ml < 5 || ml > 1000) return { error: "bad_amount", message: "Ask how many ml are in the bottle (5 to 1000)." };
      const loc = String(input.location ?? "").trim().toLowerCase();
      if (loc !== "fridge" && loc !== "freezer") return { error: "missing_location", ask: { options: ["Fridge", "Freezer"] }, message: "Ask with ask_choice whether it went in the fridge or the freezer." };
      const w = whenGiven(input.pumped_at, ctx);
      if ("error" in w) return w;
      if (Date.parse(w.at) > ctx.now.getTime() + 5 * 60_000) return { error: "in_the_future", message: "Milk cannot be pumped later than now: ask when." };
      const p: AssistantProposal = {
        id: newId(),
        kind: "milk_add",
        summary: `${loc === "freezer" ? "🧊" : "🍼"} Put away · ${ml} ml · ${loc} · pumped ${local(w.at, ctx.tz)}`,
        milk_add: { amount_ml: ml, location: loc, pumped_at: w.at, note: (input.note as string) || null },
      };
      ctx.proposals.push(p);
      return { ok: true, proposal_id: p.id, shown_as: p.summary, next: "Tell the member to tap Confirm. It is NOT in the stash yet." };
    },
  };
}

function proposeMilkMove(): AssistantTool {
  return {
    def: {
      name: "propose_milk_move",
      description: "Move one bottle in the milk stash on, for the member to confirm with one tap: thaw a frozen bag (\"took a bag out to thaw\"), warmed for a feed, used, or binned (\"threw away the old 90\", \"binned the expired one\"). Say which bottle by its ml, where it is, the day it was pumped, or its id from milk_stash. A bottle given as a feed already comes out of the stash with the feed's card: do not also mark it used.",
      input_schema: obj(
        {
          action: { type: "string", description: "thaw | warmed | used | binned" },
          amount_ml: { type: "integer", description: "The bottle's ml, if said." },
          location: { type: "string", description: "fridge | freezer, if said." },
          pumped_on: { type: "string", description: "The day it was pumped, YYYY-MM-DD, if said." },
          expired: { type: "boolean", description: "True for \"the expired one\", \"the old one past its date\"." },
          bottle_id: { type: "string", description: "The id from milk_stash, when known." },
        },
        ["action"],
      ),
    },
    run: async (input, ctx) => {
      const action = bottleAction(input.action);
      if (!action) return { error: "bad_action", options: ["thaw", "warmed", "used", "binned"] };
      const r = await rpc(ctx, "milk_list", {});
      if (!r.ok) return r;
      const bottles = ((r.bottles as Bottle[]) ?? []).filter((b) => (action === "fridge" ? b.location === "freezer" : true));
      if (!bottles.length) return { error: "nothing_there", message: action === "fridge" ? "Nothing is in the freezer to thaw." : "The stash is empty." };
      const m = matchBottle(bottles, { id: input.bottle_id, amount_ml: input.amount_ml, location: input.location, pumped_on: input.pumped_on, expired: input.expired }, (iso) => local(iso, ctx.tz)?.slice(0, 10) ?? "");
      if (!m.ok) {
        return {
          error: m.error === "ambiguous" ? "which_bottle" : "no_such_bottle",
          bottles: m.options.slice(0, 6).map((b) => ({ id: b.id.slice(0, 8), ml: b.amount_ml, where: b.location, pumped: local(b.pumped_at, ctx.tz), ...(b.expired ? { expired: true } : {}) })),
          message: m.error === "ambiguous" ? "More than one bottle fits: ask which with ask_choice (e.g. '180 ml · pumped 31 Oct'), then call again with bottle_id." : "No bottle fits what was said: tell the member what is there and ask which.",
        };
      }
      const b = m.item;
      const verb = { fridge: "Thaw", warmed: "Warmed", used: "Used", binned: "Bin" }[action];
      const icon = { fridge: "🧊", warmed: "♨️", used: "🍼", binned: "🗑️" }[action];
      const p: AssistantProposal = {
        id: newId(),
        kind: "milk_move",
        summary: `${icon} ${verb} · ${b.amount_ml} ml · ${b.location} · pumped ${local(b.pumped_at, ctx.tz)}`,
        milk_move: { bottle_id: b.id, action, amount_ml: b.amount_ml, location: b.location, pumped_at: b.pumped_at },
      };
      ctx.proposals.push(p);
      return { ok: true, proposal_id: p.id, shown_as: p.summary, next: "Tell the member to tap Confirm. Nothing has moved yet." };
    },
  };
}

type MedicineRow = { id: string; name: string; dose: string | null; min_gap_hours: number; last_at: string | null; last_dose: string | null; next_at: string | null; too_soon: boolean };

function medicinesTool(ctx0: ToolContext): AssistantTool {
  return {
    def: {
      name: "medicines",
      description: "The child's medicine list: each medicine's usual dose, the minimum hours between doses, the last dose (when and by whom) and when the next is allowed. Use for 'when can she have more Calpol', 'when was her last vitamin D'.",
      input_schema: obj({ subject: SUBJECT_PROP(ctx0) }),
    },
    run: async (input, ctx) => {
      const s = findSubject(ctx, input.subject);
      if (!s) return { error: "unknown_subject", known: ctx.subjects.map((x) => x.name) };
      const r = await rpc(ctx, "medicines_list", { p_subject_id: s.id });
      if (!r.ok) return r;
      return {
        subject: s.name,
        now: local(ctx.now.toISOString(), ctx.tz),
        medicines: ((r.items as MedicineRow[]) ?? []).map((m) => ({ name: m.name, usual_dose: m.dose, min_gap_hours: m.min_gap_hours, last_given: local(m.last_at, ctx.tz), last_dose: m.last_dose, next_allowed: local(m.next_at, ctx.tz), too_soon_now: m.too_soon })),
      };
    },
  };
}

function proposeMedicineDose(ctx0: ToolContext): AssistantTool {
  const writable = ctx0.subjects.filter((s) => s.kind === "child" && can(ctx0.me, s.module_id, "add"));
  return {
    def: {
      name: "propose_medicine_dose",
      description: `Log a dose of a medicine on ${writable.map((s) => s.name).join(" or ")}'s medicine list, for the member to confirm with one tap: "gave her 2.5 ml Calpol", "vitamin D done", "she had her drops at 8". It keeps the medicine's minimum gap between doses. Logging what the member says was given is fine; you still never suggest a medicine or a dose. A medicine not on the list: propose_care_entry with the medication type (name and dose).`,
      input_schema: obj(
        {
          medicine: { type: "string", description: "The medicine's name as said." },
          dose: { type: "string", description: "The dose given, e.g. '2.5 ml', '1 drop'. Omit for the usual dose." },
          given_at: { type: "string", description: "When, 'YYYY-MM-DD HH:MM' household time. Omit for now." },
          given_anyway: { type: "boolean", description: "Only after you told the member it was earlier than the minimum gap and they said it really was given." },
          subject: { type: "string", description: `One of ${writable.map((s) => s.name).join(", ")}. Omit when there is one.` },
          note: { type: "string" },
        },
        ["medicine"],
      ),
    },
    run: async (input, ctx) => {
      const s = findSubject(ctx, input.subject);
      if (!s || !can(ctx.me, s.module_id, "add")) return { error: "not_allowed", message: "You cannot log for that child." };
      const r = await rpc(ctx, "medicines_list", { p_subject_id: s.id });
      if (!r.ok) return r;
      const meds = (r.items as MedicineRow[]) ?? [];
      const m = matchMedicine(meds, input.medicine);
      if (!m.ok) {
        return m.error === "ambiguous"
          ? { error: "which_medicine", options: m.options.map((x) => x.name), message: "Ask which with ask_choice." }
          : { error: "not_on_the_list", known: meds.map((x) => x.name), message: `Not on ${s.name}'s medicine list. Log it with propose_care_entry, type ${s.module_id}.medication, with its name and dose; an admin can add it to the list on the Medicine screen.` };
      }
      const med = m.item;
      const w = whenGiven(input.given_at, ctx);
      if ("error" in w) return w;
      if (Date.parse(w.at) > ctx.now.getTime() + 5 * 60_000) return { error: "in_the_future", message: "A dose is logged once given: ask when it was given." };
      // The gap is checked against the time it was given, as medicine_give does: a dose logged
      // late ("she had Calpol at 6") is measured from 6, not from now.
      const lastBefore = med.last_at && Date.parse(med.last_at) <= Date.parse(w.at) ? med.last_at : null;
      const nextAt = lastBefore ? Date.parse(lastBefore) + med.min_gap_hours * 3_600_000 : null;
      const early = nextAt !== null && nextAt > Date.parse(w.at);
      if (early && input.given_anyway !== true) {
        const sameDose = lastBefore && Math.abs(Date.parse(lastBefore) - Date.parse(w.at)) < 20 * 60_000;
        return {
          error: "too_soon",
          last_given: local(lastBefore, ctx.tz),
          last_dose: med.last_dose,
          next_allowed: local(new Date(nextAt!).toISOString(), ctx.tz),
          message: sameDose
            ? `A dose of ${med.name} is already logged at ${local(lastBefore, ctx.tz)?.slice(11)}: ask whether this is the same dose before logging another.`
            : `This is earlier than the minimum gap of ${med.min_gap_hours} h for ${med.name}. Tell the member when the last dose was and when the next is allowed. Only if they say it really was given, call again with given_anyway true. If they are unsure about safety, they should ask the doctor or pharmacist.`,
        };
      }
      const dose = (typeof input.dose === "string" && input.dose.trim()) || med.dose || null;
      const p: AssistantProposal = {
        id: newId(),
        kind: "medicine_dose",
        summary: `💊 ${med.name}${dose ? ` · ${dose}` : ""} · ${s.name} · ${local(w.at, ctx.tz)}${early ? " · earlier than the usual gap" : ""}`,
        medicine_dose: { medicine_id: med.id, subject_name: s.name, name: med.name, dose, given_at: w.at, early, note: (input.note as string) || null },
      };
      ctx.proposals.push(p);
      return { ok: true, proposal_id: p.id, shown_as: p.summary, next_allowed_after: local(new Date(Date.parse(w.at) + med.min_gap_hours * 3_600_000).toISOString(), ctx.tz), next: "Tell the member to tap Confirm. It is NOT logged yet." };
    },
  };
}

function proposeVaccines(ctx0: ToolContext): AssistantTool {
  const writable = ctx0.subjects.filter((s) => s.kind === "child" && can(ctx0.me, s.module_id, "add"));
  return {
    def: {
      name: "propose_vaccines",
      description: `Mark vaccines as given in ${writable.map((s) => s.name).join(" or ")}'s vaccine book, for the member to confirm with one tap: "she had her 4 month jabs today", "rotavirus done yesterday at the clinic". Give the visit ("4 months") or one vaccine's name; with neither, the earliest visit that is due. All the visit's vaccines not yet recorded go on one card.`,
      input_schema: obj(
        {
          which: { type: "string", description: "The visit ('8 weeks', '4 months') or a vaccine's name, as said. Omit for the visit that is due." },
          given_on: { type: "string", description: "The day, YYYY-MM-DD. Omit for today." },
          place: { type: "string", description: "Where, if said (the clinic's name)." },
          subject: { type: "string", description: `One of ${writable.map((s) => s.name).join(", ")}. Omit when there is one.` },
        },
      ),
    },
    run: async (input, ctx) => {
      const s = findSubject(ctx, input.subject);
      if (!s || !can(ctx.me, s.module_id, "add")) return { error: "not_allowed", message: "You cannot record vaccines for that child." };
      const today = todayYmd(ctx.tz, ctx.now);
      const day = String(input.given_on ?? "").trim().slice(0, 10) || today;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { error: "bad_date", message: "Ask which day, then call again with YYYY-MM-DD." };
      if (day > today) return { error: "in_the_future", message: "Vaccines are recorded once given: ask which day they were given." };
      const r = await rpc(ctx, "vaccines_list", { p_subject_id: s.id });
      if (!r.ok) return r;
      const items = ((r.items as VaccineItem[]) ?? []).map((v) => ({ id: v.id, visit: v.visit, vaccine: v.vaccine, dose: v.dose, status: v.status, due_on: v.due_on }));
      const m = matchVaccines(items, input.which);
      if (!m.ok) {
        const msg = { unknown: "No visit or vaccine of that name: ask which visit, with the visits as options.", already_given: "Those are already recorded as given: tell the member.", nothing_due: "No visit is due now: ask which visit it was." }[m.error];
        return { error: m.error, visits: m.visits, message: msg };
      }
      const p: AssistantProposal = {
        id: newId(),
        kind: "vaccines",
        summary: `💉 ${m.visit} · ${m.items.map((v) => v.vaccine.replace(/\s*\(.*\)$/, "")).join(", ")} · ${s.name} · given ${day}`,
        vaccines: { subject_id: s.id, subject_name: s.name, visit: m.visit, given_on: day, place: (typeof input.place === "string" && input.place.trim()) || null, items: m.items.map((v) => ({ schedule_id: v.id, vaccine: v.vaccine })) },
      };
      ctx.proposals.push(p);
      return { ok: true, proposal_id: p.id, shown_as: p.summary, next: "Tell the member to tap Confirm. Nothing is recorded yet." };
    },
  };
}

function loadSkill(): AssistantTool {
  return {
    def: {
      name: "load_skill",
      description: "Read one of your skills from the index by id (sleep, feeding, teething, solids, illness, development, mama…) when the question needs it and it is not already under SKILLS IN USE. Returns the skill's text. Call at most twice per answer.",
      input_schema: obj({ id: { type: "string", description: "The skill id from the index." } }, ["id"]),
    },
    run: async (input, ctx) => {
      const id = String(input.id ?? "").trim().toLowerCase();
      const s = ctx.skills.find((x) => x.id === id && x.is_active);
      if (!s) return { error: "unknown_skill", known: ctx.skills.filter((x) => x.is_active && !x.always_on).map((x) => x.id) };
      if (!ctx.loaded.some((x) => x.id === s.id)) ctx.loaded.push(s);
      return { id: s.id, title: s.title, text: skillText(s) };
    },
  };
}

export function buildTools(ctx: ToolContext): AssistantTool[] {
  const me = ctx.me;
  const list: AssistantTool[] = [whoIsHome(), askChoice()];
  if (can(me, "assistant", "view")) {
    list.push(remember());
    if (ctx.facts.length) list.push(forgetMemory());
  }
  if (ctx.skills.some((s) => s.is_active && !s.always_on) && ctx.subjects.some((s) => s.kind === "child")) list.push(loadSkill());
  if (can(me, "calendar", "view")) list.push(calendar(ctx));
  const careSubjects = ctx.subjects.filter((s) => can(me, s.module_id, "view"));
  if (careSubjects.length) {
    list.push(careNow(ctx), careEntries(ctx));
    if (careSubjects.some((s) => s.kind === "child")) list.push(careStats(ctx), sleepRhythm(ctx), coachPlan(ctx), ageOutlookTool(ctx), dayScheduleTool(ctx), redFlagCheck(ctx), planHistory(ctx));
    list.push(recentChats());
    list.push(dueSoon());
  }
  // The milk stash belongs to the lana module (milk_list, milk_add and milk_move check lana).
  const milk = ctx.subjects.some((s) => s.module_id === "lana");
  if (careSubjects.some((s) => s.kind === "child")) list.push(medicinesTool(ctx));
  if (milk && can(me, "lana", "view")) list.push(milkStash());
  if (can(me, "assistant", "add")) {
    if (ctx.subjects.some((s) => can(me, s.module_id, "add"))) list.push(proposeCareEntry(ctx), proposeEndTimer(ctx), proposeCustody(ctx));
    if (ctx.subjects.some((s) => s.kind === "child" && can(me, s.module_id, "add"))) list.push(proposePlan(ctx), proposeMedicineDose(ctx), proposeVaccines(ctx));
    if (ctx.subjects.some((s) => can(me, s.module_id, "edit"))) list.push(proposeEntryChange(ctx));
    if (ctx.subjects.some((s) => can(me, s.module_id, "delete"))) list.push(proposeEntryDelete(ctx));
    if (milk && can(me, "lana", "add")) list.push(proposeMilkAdd(), proposeMilkMove());
    if (can(me, "calendar", "add")) list.push(proposeCalendarEvent());
  }
  return list;
}

/** The role's label ("Family carer"), else its id made readable ("family_carer" → "family carer"). */
function roleLabel(roleId: string, roles: { id: string; label: string }[]): string {
  return roles.find((r) => r.id === roleId)?.label ?? roleId.replace(/_/g, " ");
}

/** Load what the member may see, once per request. RLS does the filtering. */
export async function loadContext(supabase: SupabaseClient, me: Me, now = new Date(), opts: { question?: string; history?: string[]; screen?: string | null; chat?: string | null } = {}): Promise<ToolContext> {
  type MemberRow = { id: string; display_name: string; routine: string | null; role_id: string; relationship: string | null };
  type SubjectRow = Omit<SubjectInfo, "sex" | "species"> & { profile: Record<string, unknown> | null };
  const [{ data: subjects }, { data: types }, { data: members }, { data: roles }, { data: memData }, { data: skillData }, { data: recapData }] = await Promise.all([
    supabase.from("care_subjects").select("id,name,module_id,kind,birth_date,profile").eq("is_active", true).order("sort"),
    supabase.from("care_entry_types").select("*").eq("is_active", true).order("module_id").order("sort"),
    supabase.from("members").select("id,display_name,routine,role_id,relationship").eq("is_active", true).order("display_name"),
    supabase.from("roles").select("id,label"),
    supabase.rpc("memory_list"),
    supabase.rpc("skill_list", { p_all: false }),
    // The chat in progress is not one of the earlier chats.
    opts.chat ? supabase.rpc("ask_chat_recaps", { p_limit: 6, p_exclude: opts.chat }) : supabase.rpc("ask_chat_recaps", { p_limit: 6 }),
  ]);
  const subs: SubjectInfo[] = (((subjects as SubjectRow[] | null) ?? []) as SubjectRow[]).map(({ profile, ...s }) => ({
    ...s,
    sex: typeof profile?.sex === "string" ? profile.sex : null,
    species: typeof profile?.species === "string" ? profile.species : null,
    ambulance: ambulanceOf(profile),
  }));
  const people = ((members as MemberRow[] | null) ?? []).map((m) => ({ id: m.id, name: m.display_name, routine: m.routine, relationship: m.relationship, role: roleLabel(m.role_id, (roles as { id: string; label: string }[] | null) ?? []) }));
  // Names are noise when matching memories to a question: the household's subjects and members.
  const names = [...subs.map((s) => s.name), ...people.map((p) => p.name)];
  const facts = (((memData as { ok?: boolean; items?: MemoryFact[] } | null)?.items ?? []) as MemoryFact[]).map((m) => ({ id: m.id, body: m.body, kind: m.kind, status: m.status, about: m.about ?? null, subject: m.subject ?? null, expires_at: m.expires_at ?? null, created_at: m.created_at, by: m.by }));
  const memories = selectMemories(opts.question ?? "", opts.history ?? [], facts, MAX_FACTS, names, me.member.id);
  const recaps = ((recapData as { ok?: boolean; items?: ChatRecap[] } | null)?.items ?? []) as ChatRecap[];
  const skills = (((skillData as { ok?: boolean; items?: AssistantSkill[] } | null)?.items ?? []) as AssistantSkill[]).map((s) => ({ ...s, triggers: Array.isArray(s.triggers) ? s.triggers : [] }));
  const child = subs.find((s) => s.kind === "child" && s.birth_date);
  const ageDays = ageInDays(child?.birth_date, now.getTime(), me.household.timezone);
  const selection = selectSkills(opts.question ?? "", skills, { ageDays, history: opts.history });
  return {
    skills,
    selection,
    facts,
    recaps,
    loaded: [],
    screen: opts.screen ?? null,
    situation: "",
    supabase,
    me,
    tz: me.household.timezone,
    now,
    subjects: subs,
    types: (types as EntryType[]) ?? [],
    routines: people.filter((p): p is typeof p & { routine: string } => !!p.routine).map((p) => ({ name: p.name, routine: p.routine })),
    people: people.map(({ id, name, role, relationship }) => ({ id, name, role, relationship })),
    memories,
    refs: {},
    proposals: [],
    choice: null,
  };
}
