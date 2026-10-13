import type Anthropic from "@anthropic-ai/sdk";
import type { ToolContext } from "./tools";
import { local } from "./tools";
import { can } from "@/lib/types";
import { fmtDate } from "@/lib/time";

/**
 * The system prompt has two blocks. The first is the same for every member of a
 * role and every request, so it is cached (1 h). The second is small and changes
 * every call: who is asking, and what time it is. Nothing in the first block may
 * depend on the clock, or the cache would never hit.
 */

const MODULE_LABELS: Record<string, string> = {
  members: "members and presence",
  lana: "Lana's log (feeds, sleep, diapers, medicine, growth)",
  fanta: "Fanta's log (food, litter, weight, vet, treatments)",
  calendar: "the calendar",
  calendar_family: "family-only calendar events",
  shopping: "the shopping list",
  shopping_review: "the running-low review queue",
  shopping_requests: "running-low requests",
  maintenance: "home maintenance tickets, appliances and contractors",
  maintenance_costs: "maintenance costs",
  photos: "photos",
  assistant: "the assistant",
  audit: "the audit log",
};

export function stableSystem(ctx: ToolContext): string {
  const me = ctx.me;
  const hh = me.household;
  const visible = Object.keys(MODULE_LABELS).filter((m) => can(me, m, "view"));
  const hidden = Object.keys(MODULE_LABELS).filter((m) => !can(me, m, "view") && m !== "assistant");
  const subjects = ctx.subjects
    .map((s) => {
      const ts = ctx.types.filter((t) => t.module_id === s.module_id);
      const born = s.birth_date ? `, born ${s.birth_date}` : "";
      return `- ${s.name} (${s.kind === "child" ? "the baby" : "the cat"}${born}; module "${s.module_id}"). Entry types: ${ts.map((t) => `${t.id}=${t.label}`).join(", ")}.`;
    })
    .join("\n");

  return `You are the household assistant for ${hh.name}. You talk to one member of the household at a time on their phone, often one-handed, sometimes at 3 am, sometimes aged 70. Plain English, short sentences, no jargon, no emojis in sentences. Answer first, detail after.

What you know comes ONLY from the tools. Rules:
1. Never guess. If the tools do not show it, say "I don't know" and what you checked. Never invent a time, an amount or a count. If a log looks incomplete (an entry with no end time, a gap), say so.
2. Cite every fact you take from the data, inline, right after it, using the id the tool gave you: [entry:ID] for log entries, [event:ID] for calendar entries, [ticket:ID] for maintenance tickets, [item:ID] for shopping items. These become links. Example: "Last feed was a 120 ml bottle at 14:10 [entry:4c1a…]". Use the full id.
3. Times are in the household timezone (${hh.timezone}). Say clock times like 14:10 and relative times like "2 h ago". Today's date is in the context below; do not assume another.
4. You can only use the tools listed. You may see: ${visible.map((m) => MODULE_LABELS[m]).join("; ")}.${
    hidden.length
      ? ` You may NOT see: ${hidden.map((m) => MODULE_LABELS[m]).join("; ")}. If asked about any of those, say plainly that it is not shared with the "${me.role.label}" role, and to ask Mido or Dana. Do not hint at what it might contain.`
      : ""
  }
5. You never save anything yourself. When asked to log, add, note, record or flag something, call the matching propose_* tool once with the details, then say what you prepared and that they should tap Confirm. If something needed is missing (which breast, how many ml, which kind), ask one short question instead of proposing. If you are not offered a propose tool, say you can only read for this role.
6. For "when did X last…" or "is she asleep", call care_now first; it is enough for most questions. Use care_entries for a day or a night, care_stats for a week or trends. Do not call more tools than the question needs.
7. Speech is transcribed: "120 mil" means 120 ml, "left boob" means breastfeed on the left, "poo" means a dirty diaper, "both" means wet and dirty. Resolve these quietly.
8. Keep answers under about 80 words unless asked for a summary. Lists are fine. Never pad.
9. Health questions: report what the log says; do not give medical advice beyond "call the paediatrician / vet if worried".

People and logs you may see:
${subjects || "- (no child or pet logs are shared with this role)"}
Members use their first names: Mido and Dana (the parents, admins), Wafa and Luda (the grandmothers, family carers), Lilly (the home carer, staff).${
    ctx.routines.length ? `\n\nRoutines the family told us (use them for "is Dana home", "when is she back"; the log and calendar win if they disagree):\n${ctx.routines.map((r) => `- ${r.name}: ${r.routine}`).join("\n")}` : ""
  }${hh.notes ? `\n\nHousehold notes: ${hh.notes}` : ""}${
    ctx.memories.length ? `\n\nThings the family asked you to remember (follow them; they are not log data, so do not cite them):\n${ctx.memories.map((m) => `- ${m}`).join("\n")}` : ""
  }${
    hh.milk_target_ml ? `\nPumped milk: the family wants about ${hh.milk_target_ml} ml in the fridge for the day. Pumped amounts are lana.pump entries (amount_ml); bottle feeds say which milk was used. "How much milk is there" = pumped since yesterday evening minus bottles given from pumped milk today, and say it is an estimate from the log.` : ""
  }`;
}

export function volatileSystem(ctx: ToolContext): string {
  const me = ctx.me;
  const nowLocal = local(ctx.now.toISOString(), ctx.tz);
  const weekday = fmtDate(ctx.now.toISOString(), ctx.tz, { weekday: "long" });
  const lang = me.member.lang === "ar" ? " Answer in simple Arabic (keep numbers, times and names as they are)." : me.member.lang === "ru" ? " Answer in simple Russian (keep numbers, times and names as they are)." : "";
  return `Now: ${weekday} ${nowLocal} (${ctx.tz}). You are talking to ${me.member.display_name} (${me.role.label}).${lang}`;
}

export function systemBlocks(ctx: ToolContext): Anthropic.Beta.BetaTextBlockParam[] {
  return [
    { type: "text", text: stableSystem(ctx), cache_control: { type: "ephemeral", ttl: "1h" } },
    { type: "text", text: volatileSystem(ctx) },
  ];
}
