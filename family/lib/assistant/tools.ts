import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssistantProposal, AssistantRef, EntryType, EventKind, FieldDef, Me } from "@/lib/types";
import { EVENT_KINDS, can } from "@/lib/types";
import { addDays, dayRange, fromLocalInput, todayYmd, toLocalInput } from "@/lib/time";

/**
 * The assistant's tools are thin wrappers over the RPCs the screens already use,
 * called with the member's own session. Row Level Security therefore decides what
 * the assistant can see, exactly as it decides what the member can see. A tool
 * is only offered when the member has the permission the screen would need, so
 * a home carer's assistant has no Lana tool at all — nothing to leak.
 */

export interface SubjectInfo {
  id: string;
  name: string;
  module_id: string;
  kind: "child" | "pet";
  birth_date: string | null;
}

export interface ToolContext {
  supabase: SupabaseClient;
  me: Me;
  tz: string;
  now: Date;
  subjects: SubjectInfo[];
  types: EntryType[];
  /** Every id the tools returned, so the answer's citations become links. */
  refs: Record<string, AssistantRef>;
  /** Writes the assistant asked for. The member confirms them in the UI. */
  proposals: AssistantProposal[];
}

export interface AssistantTool {
  def: Anthropic.Beta.BetaTool;
  run: (input: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

type Rpc = { ok: boolean; message?: string; error?: string } & Record<string, unknown>;

async function rpc(ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<Rpc> {
  const { data, error } = await ctx.supabase.rpc(name, args);
  if (error) return { ok: false, error: "rpc_failed", message: error.message };
  return (data as Rpc) ?? { ok: false, error: "empty" };
}

/** Local wall-clock for the model: "2026-10-11 14:10". */
export function local(iso: string | null | undefined, tz: string): string | null {
  if (!iso) return null;
  return toLocalInput(iso, tz).replace("T", " ");
}

/** Accepts "2026-10-11", "2026-10-11 14:10", "2026-10-11T14:10" or an ISO instant, in the household timezone. */
export function parseWhen(s: string | null | undefined, tz: string, fallback: Date): string {
  if (!s) return fallback.toISOString();
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return fromLocalInput(`${t}T00:00`, tz);
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/.test(t)) return fromLocalInput(t.replace(" ", "T"), tz);
  const d = new Date(t);
  return isNaN(d.getTime()) ? fallback.toISOString() : d.toISOString();
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
      description: "Who is in the house today, who is away, and who is working today (staff work days). Use for 'who's home', 'is Lilly working', 'where is Wafa'.",
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
        "The current state of a child's or pet's log: the latest entry of every kind (last feed, nap, diaper, medicine, litter, food…) with when it was and when the next is due, anything still running (asleep, feeding), who has the child, and today's counts and entries. Cheapest first call for 'when did X last…', 'is Lana asleep', 'how many feeds today'.",
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
        "Every log entry for a child or pet between two moments (feeds, sleeps, diapers, medicine, notes, food, litter, vet…), newest first. Use for a day, a night, or 'the last three feeds'. For 'last X' prefer care_now. Window: at most 14 days.",
      input_schema: obj(
        {
          subject: SUBJECT_PROP(ctx0),
          from: { type: "string", description: "Start, 'YYYY-MM-DD' (midnight) or 'YYYY-MM-DD HH:MM', household time." },
          to: { type: "string", description: "End (exclusive), same format. Omit for now." },
          type: { type: "string", description: "Optional: only this entry type id, e.g. lana.feed, lana.sleep, fanta.food." },
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
        "Daily totals for a child over a date range: feeds (breast count/minutes, left/right, bottles and ml, pumped), sleep (total, naps, night, longest stretch, night wake-ups, night feeds), diapers, weight/length/head, milestones. One row per day. Use for 'how did she sleep this week', 'is she drinking more than last week', trends. Up to 92 days.",
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
      description: "What is due or overdue for the children and pets you can see: next vaccination, deworming, flea treatment (from the last treatment's 'next due'), and timed things like the next meal or litter change. Use for 'what's due for Fanta', 'when is the next vaccination'.",
      input_schema: obj({ days_ahead: { type: "integer", description: "How far ahead to look. Default 30." } }),
    },
    run: async (input, ctx) => {
      const r = await rpc(ctx, "care_due_list", { p_days_ahead: Number(input.days_ahead ?? 30) || 30 });
      if (!r.ok) return r;
      return {
        items: ((r.items as Record<string, unknown>[]) ?? []).map((d) => {
          if (d.entry_id) ctx.refs[d.entry_id as string] = { href: `/${d.module_id}/entry/${d.entry_id}`, label: `${d.label}` };
          return { subject: d.subject, what: d.label, due: local(d.due_at as string, ctx.tz), overdue: d.overdue, entry_id: d.entry_id ?? undefined };
        }),
      };
    },
  };
}

function shoppingList(): AssistantTool {
  return {
    def: {
      name: "shopping_list",
      description: "The shared shopping list: what is marked as needed now, what is probably running out (by reorder interval), with owner, usual shop, size, last bought and last price; plus how many running-low requests are waiting for review.",
      input_schema: obj({ only_needed: { type: "boolean", description: "True to return only items marked needed or due. Default false (everything)." } }),
    },
    run: async (input, ctx) => {
      const r = await rpc(ctx, "shopping_list", {});
      if (!r.ok) return r;
      const today = todayYmd(ctx.tz, ctx.now);
      let items = (r.items as Record<string, unknown>[]) ?? [];
      if (input.only_needed) items = items.filter((i) => i.needed || (i.due && String(i.due) <= today));
      return {
        pending_requests: r.pending_requests,
        items: items.map((i) => {
          ctx.refs[i.id as string] = { href: `/shopping/${i.id}`, label: String(i.name) };
          return {
            id: i.id,
            name: i.name,
            category: i.category,
            needed: i.needed,
            probably_out_by: i.due ?? undefined,
            owner: i.owner_name ?? undefined,
            shop: i.store_label ?? undefined,
            size: i.size ?? undefined,
            quantity_on_hand: i.quantity_on_hand ?? undefined,
            last_bought: i.last_bought_on ?? undefined,
            last_price: i.last_price ?? undefined,
            note: i.note ?? undefined,
          };
        }),
      };
    },
  };
}

function house(): AssistantTool {
  return {
    def: {
      name: "house",
      description: "Home maintenance: open tickets (what is broken, where, status, priority, which contractor), and recently closed ones. Use for 'is the AC fixed', 'who is coming to fix the dishwasher', 'anything urgent in the house'.",
      input_schema: obj({ status: { type: "string", description: "open (default), in_progress, waiting, done, or all." } }),
    },
    run: async (input, ctx) => {
      const status = String(input.status ?? "open");
      const r = await rpc(ctx, "tickets_list", { p_status: status === "all" ? null : status });
      if (!r.ok) return r;
      return {
        costs_visible: r.costs_visible,
        tickets: ((r.tickets as Record<string, unknown>[]) ?? []).slice(0, 50).map((t) => {
          ctx.refs[t.id as string] = { href: `/house/tickets/${t.id}`, label: String(t.title) };
          return {
            id: t.id,
            title: t.title,
            where: t.location ?? undefined,
            status: t.status,
            priority: t.priority,
            appliance: t.asset_name ?? undefined,
            contractor: t.contractor_name ?? undefined,
            opened: local(t.created_at as string, ctx.tz),
            opened_by: t.opened_by_name ?? undefined,
            closed: local(t.closed_at as string | null, ctx.tz) ?? undefined,
            ...(r.costs_visible ? { cost_total: t.cost_total } : {}),
          };
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
      description: `Prepare a log entry for the member to confirm with one tap. Call this when asked to log, record or note something for ${writable.map((s) => s.name).join(" or ")}. Fill every required field from what was said; if a required field is missing or ambiguous, ask instead of calling. Times default to now. Types and their fields:\n${typeHelp}`,
      input_schema: obj(
        {
          subject: { type: "string", description: `One of ${writable.map((s) => s.name).join(", ")}.` },
          type_id: { type: "string", description: "The entry type id, e.g. lana.feed." },
          occurred_at: { type: "string", description: "When it happened, 'YYYY-MM-DD HH:MM' household time. Omit for now." },
          ended_at: { type: "string", description: "When it ended, for sleeps and feeds with a known end. Omit if unknown or still going." },
          payload: { type: "object", description: "The type's fields as key → value, e.g. {\"method\":\"Bottle\",\"amount_ml\":120,\"milk\":\"Formula\"}." },
          note: { type: "string", description: "A short free-text note if the member said something worth keeping." },
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
      const missing = t.fields.filter((f) => f.required && (payload[f.key] === undefined || payload[f.key] === "")).map((f) => f.key);
      if (missing.length) return { error: "missing_fields", missing, message: "Ask the member for these before proposing." };
      const bad = t.fields.filter((f) => f.options?.length && payload[f.key] !== undefined && !f.options.includes(String(payload[f.key]))).map((f) => ({ field: f.key, options: f.options }));
      if (bad.length) return { error: "bad_option", bad };
      const occurred = parseWhen(input.occurred_at as string | undefined, ctx.tz, ctx.now);
      const ended = input.ended_at ? parseWhen(input.ended_at as string, ctx.tz, ctx.now) : null;
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
      };
      ctx.proposals.push(p);
      return { ok: true, proposal_id: p.id, shown_as: p.summary, next: "Tell the member to tap Confirm. It is NOT saved yet." };
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
      const starts = parseWhen(input.starts_at as string, ctx.tz, ctx.now);
      const ends = input.ends_at ? parseWhen(input.ends_at as string, ctx.tz, ctx.now) : null;
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

function proposeShopping(ctx0: ToolContext): AssistantTool {
  const request = !can(ctx0.me, "shopping", "add") && can(ctx0.me, "shopping_requests", "add");
  return {
    def: {
      name: "propose_shopping",
      description: request
        ? "Prepare a running-low request for the member to confirm: it goes to Mido or Dana to approve onto the list."
        : "Prepare a shopping change for the member to confirm: mark an item on the list as needed, or add a new item.",
      input_schema: obj(
        {
          item_name: { type: "string", description: "What is needed, as the member said it." },
          note: { type: "string", description: "Optional: size, brand, how many." },
        },
        ["item_name"],
      ),
    },
    run: async (input, ctx) => {
      const name = String(input.item_name ?? "").trim();
      if (!name) return { error: "no_name" };
      let itemId: string | null = null;
      let via: "needed" | "new" | "request" = request ? "request" : "new";
      if (!request) {
        const r = await rpc(ctx, "shopping_list", {});
        const items = ((r.items as Record<string, unknown>[]) ?? []).filter((i) => String(i.name).toLowerCase() === name.toLowerCase() || String(i.name).toLowerCase().includes(name.toLowerCase()));
        if (items.length === 1) {
          itemId = items[0].id as string;
          via = "needed";
        }
      }
      const p: AssistantProposal = {
        id: newId(),
        kind: "shopping",
        summary: via === "request" ? `🛒 Ask for ${name}${input.note ? ` (${input.note})` : ""}` : via === "needed" ? `🛒 Mark "${name}" as needed` : `🛒 Add "${name}" to the list${input.note ? ` (${input.note})` : ""}`,
        shopping: { item_id: itemId, item_name: name, note: (input.note as string) || null, via },
      };
      ctx.proposals.push(p);
      return { ok: true, proposal_id: p.id, shown_as: p.summary, next: "Tell the member to tap Confirm. It is NOT saved yet." };
    },
  };
}

/** The tools this member may use, in a fixed order (a stable list caches). */
export function buildTools(ctx: ToolContext): AssistantTool[] {
  const me = ctx.me;
  const list: AssistantTool[] = [whoIsHome()];
  if (can(me, "calendar", "view")) list.push(calendar(ctx));
  const careSubjects = ctx.subjects.filter((s) => can(me, s.module_id, "view"));
  if (careSubjects.length) {
    list.push(careNow(ctx), careEntries(ctx));
    if (careSubjects.some((s) => s.kind === "child")) list.push(careStats(ctx));
    list.push(dueSoon());
  }
  if (can(me, "shopping", "view") || can(me, "shopping_requests", "add")) list.push(shoppingList());
  if (can(me, "maintenance", "view")) list.push(house());
  if (can(me, "assistant", "add")) {
    if (ctx.subjects.some((s) => can(me, s.module_id, "add"))) list.push(proposeCareEntry(ctx));
    if (can(me, "calendar", "add")) list.push(proposeCalendarEvent());
    if (can(me, "shopping", "add") || can(me, "shopping_requests", "add")) list.push(proposeShopping(ctx));
  }
  return list;
}

/** Load what the member may see, once per request. RLS does the filtering. */
export async function loadContext(supabase: SupabaseClient, me: Me, now = new Date()): Promise<ToolContext> {
  const [{ data: subjects }, { data: types }] = await Promise.all([
    supabase.from("care_subjects").select("id,name,module_id,kind,birth_date").eq("is_active", true).order("sort"),
    supabase.from("care_entry_types").select("*").eq("is_active", true).order("module_id").order("sort"),
  ]);
  return {
    supabase,
    me,
    tz: me.household.timezone,
    now,
    subjects: (subjects as SubjectInfo[]) ?? [],
    types: (types as EntryType[]) ?? [],
    refs: {},
    proposals: [],
  };
}
