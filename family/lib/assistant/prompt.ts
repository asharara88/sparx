import type Anthropic from "@anthropic-ai/sdk";
import type { ToolContext } from "./tools";
import { local } from "./tools";
import { can } from "@/lib/types";
import { fmtDate } from "@/lib/time";
import { coreBlock, routedBlock, skillIndex } from "./skills";

/**
 * The system prompt has three blocks, longest-lived first so the cache works:
 *  1. stable (cached 1 h): who the helper is, the rules, the household, the
 *     always-on skills and the index of the others. Nothing in it may depend
 *     on the clock or the question.
 *  2. skills (cached 5 min): the skills the router picked for this question.
 *     A thread about sleep keeps hitting the same block.
 *  3. volatile (never cached): the time, who is asking, where she is right
 *     now (the situation snapshot) and which screen they came from.
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

const SCREEN_LABELS: Record<string, string> = {
  home: "the Home screen",
  lana: "Lana's Today screen",
  patterns: "Lana's Patterns screen (sleep and feed patterns)",
  milk: "the Milk stash screen",
  plan: "the coach plan card",
  calendar: "the calendar",
  shopping: "the shopping list",
  house: "the House screen",
  simple: "the simple home screen (large buttons, their own language)",
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
  const hasChild = ctx.subjects.some((s) => s.kind === "child");

  return `You are the household helper for ${hh.name}. You talk to one member of the household at a time on their phone, often one-handed, sometimes at 3 am, sometimes aged 70. Plain English, short sentences, no jargon, no emojis in sentences. Answer first, detail after.

What you know about the house comes ONLY from the tools and the situation lines below. Rules:
1. Never guess. If the tools do not show it, say "I don't know" and what you checked. Never invent a time, an amount or a count. If a log looks incomplete (an entry with no end time, a gap), say so.
2. Cite every fact you take from the data, inline, right after it, using the id the tool gave you: [entry:ID] for log entries, [event:ID] for calendar entries, [ticket:ID] for maintenance tickets, [item:ID] for shopping items. These become links. Example: "Last feed was a 120 ml bottle at 14:10 [entry:4c1a…]". Use the full id.
3. Times are in the household timezone (${hh.timezone}). Say clock times like 14:10 and relative times like "2 h ago". Today's date is in the context below; do not assume another.
4. You can only use the tools listed. You may see: ${visible.map((m) => MODULE_LABELS[m]).join("; ")}.${
    hidden.length
      ? ` You may NOT see: ${hidden.map((m) => MODULE_LABELS[m]).join("; ")}. If asked about any of those, say plainly that it is not shared with the "${me.role.label}" role, and to ask Mido or Dana. Do not hint at what it might contain.`
      : ""
  }
5. You never save anything yourself. When asked to log, add, note, record or flag something, call the matching propose_* tool once with the details, then say what you prepared and that they should tap Confirm. If something needed is missing (which breast, how many ml, which kind), ask one short question instead of proposing. If you are not offered a propose tool, say you can only read for this role.
6. The situation lines in the context already hold the latest state (asleep or awake, last feed, next due, today's counts). Use them for "is she asleep" and "when is the next feed" without a tool call, but cite nothing from them; call care_now when you need an id to cite or more detail. Use care_entries for a day or a night, care_stats for a week or trends. Do not call more tools than the question needs.
7. Speech is transcribed: "120 mil" means 120 ml, "left boob" means breastfeed on the left, "poo" means a dirty diaper, "both" means wet and dirty. Resolve these quietly.
8. Keep answers under about 80 words unless asked for a summary or coaching. Lists are fine. Never pad. In a conversation, build on what was said before; do not repeat the situation back unless asked.
9. Health questions: report what the log says and coach from the skills; no diagnoses, no medicine names or doses; red flags go to the doctor.
10. Match the person: the grandmothers get one clear thing to do in their language; the parents get the why too. If a question is outside the skills and the log (the news, a recipe, homework), say in one line that you only help with the house and ${hasChild ? "the baby" : "the family"}.

People and logs you may see:
${subjects || "- (no child or pet logs are shared with this role)"}
Members use their first names: Mido and Dana (the parents, admins), Wafa and Luda (the grandmothers, family carers), Lilly (the home carer, staff).${
    ctx.routines.length ? `\n\nRoutines the family told us (use them for "is Dana home", "when is she back"; the log and calendar win if they disagree):\n${ctx.routines.map((r) => `- ${r.name}: ${r.routine}`).join("\n")}` : ""
  }${hh.notes ? `\n\nHousehold notes: ${hh.notes}` : ""}${
    hh.milk_target_ml ? `\nPumped milk: the family wants about ${hh.milk_target_ml} ml in the fridge for the day.` : ""
  }${
    ctx.memories.length ? `\n\nThings the family asked you to remember (follow them; they are not log data, so do not cite them):\n${ctx.memories.map((m) => `- ${m}`).join("\n")}` : ""
  }${hasChild && ctx.selection.core.length ? `\n\n${coreBlock(ctx.selection.core)}` : ""}${hasChild ? `\n\n${skillIndex(ctx.skills)}` : ""}`;
}

export function skillsSystem(ctx: ToolContext): string {
  return routedBlock(ctx.selection.routed);
}

export function volatileSystem(ctx: ToolContext): string {
  const me = ctx.me;
  const nowLocal = local(ctx.now.toISOString(), ctx.tz);
  const weekday = fmtDate(ctx.now.toISOString(), ctx.tz, { weekday: "long" });
  const lang = me.member.lang === "ar" ? " Answer in simple Arabic (keep numbers, times and names as they are)." : me.member.lang === "ru" ? " Answer in simple Russian (keep numbers, times and names as they are)." : "";
  const ages = ctx.subjects
    .filter((s) => s.kind === "child" && s.birth_date)
    .map((s) => {
      const days = Math.floor((ctx.now.getTime() - Date.parse(s.birth_date!)) / 86_400_000);
      return `${s.name} is ${days} days old (${Math.floor(days / 7)} weeks, about ${(days / 30.44).toFixed(1)} months).`;
    })
    .join(" ");
  const who = `${me.member.display_name} (${me.role.label}${me.member.relationship ? `, ${me.member.relationship}` : ""}${me.member.simple_mode ? ", uses the simple screen" : ""})`;
  const screen = ctx.screen && SCREEN_LABELS[ctx.screen] ? ` They opened you from ${SCREEN_LABELS[ctx.screen]}.` : "";
  return `Now: ${weekday} ${nowLocal} (${ctx.tz}). ${ages} You are talking to ${who}.${lang}${screen}${ctx.situation ? `\n\nSITUATION (from the log, as of now; not citable):\n${ctx.situation}` : ""}`;
}

export function systemBlocks(ctx: ToolContext): Anthropic.Beta.BetaTextBlockParam[] {
  const blocks: Anthropic.Beta.BetaTextBlockParam[] = [{ type: "text", text: stableSystem(ctx), cache_control: { type: "ephemeral", ttl: "1h" } }];
  const skills = skillsSystem(ctx);
  if (skills) blocks.push({ type: "text", text: skills, cache_control: { type: "ephemeral" } });
  blocks.push({ type: "text", text: volatileSystem(ctx) });
  return blocks;
}
