import type Anthropic from "@anthropic-ai/sdk";
import type { ToolContext } from "./tools";
import { local } from "./tools";
import { can } from "@/lib/types";
import { fmtDate } from "@/lib/time";
import { childName, possessive } from "@/lib/names";
import { coreBlock, routedBlock, skillIndex } from "./skills";
import { memoriesBlock, recapsBlock } from "./memory";
import { ageInDays, range, stageOf } from "@/lib/stage";

/**
 * The system prompt has three blocks, longest-lived first so the cache works:
 *  1. stable (cached 1 h): who the helper is, the rules, the household, the
 *     always-on skills and the index of the others. Nothing in it may depend
 *     on the clock or the question.
 *  2. skills and memories (cached 5 min): the skills the router picked for
 *     this question and the memories that matter for it (grouped by what they
 *     are about). A thread about sleep keeps hitting the same block.
 *  3. volatile (never cached): the time, who is asking, where the child is
 *     right now (the situation snapshot) and which screen they came from.
 */

/** The child's name: from the subjects this member may see, else from me() (visible to everyone). */
function namesOf(ctx: ToolContext): { child: string } {
  return {
    child: ctx.subjects.find((s) => s.kind === "child")?.name ?? childName(ctx.me),
  };
}

function moduleLabels(ctx: ToolContext): Record<string, string> {
  const { child } = namesOf(ctx);
  return {
    members: "members and presence",
    lana: `${possessive(child)} log (feeds, sleep, diapers, medicine, growth)`,
    calendar: "the calendar",
    calendar_family: "family-only calendar events",
    photos: "photos",
    assistant: "the assistant",
    audit: "the audit log",
  };
}

function screenLabels(ctx: ToolContext): Record<string, string> {
  const { child } = namesOf(ctx);
  return {
    home: "the Home screen",
    child: `${possessive(child)} Today screen`,
    patterns: `${possessive(child)} Patterns screen (sleep and feed patterns)`,
    milk: "the Milk stash screen",
    plan: "the coach plan card",
    calendar: "the calendar",
    simple: "the simple home screen (large buttons, their own language)",
  };
}

/** "Mido (Parent, admin)", "Wafa (Mido's mother, family carer)", "Lilly (staff)". */
function describePerson(p: ToolContext["people"][number]): string {
  const role = p.role.toLowerCase();
  return `${p.name} (${[p.relationship, role].filter(Boolean).join(", ")})`;
}

export function stableSystem(ctx: ToolContext): string {
  const me = ctx.me;
  const hh = me.household;
  const MODULE_LABELS = moduleLabels(ctx);
  const visible = Object.keys(MODULE_LABELS).filter((m) => can(me, m, "view"));
  const hidden = Object.keys(MODULE_LABELS).filter((m) => !can(me, m, "view") && m !== "assistant");
  const subjects = ctx.subjects
    .map((s) => {
      const ts = ctx.types.filter((t) => t.module_id === s.module_id);
      const born = s.birth_date ? `, born ${s.birth_date}` : "";
      // The number to give in an emergency is the family's own, never one assumed for their country.
      const sos = s.ambulance ? ` Emergency (ambulance) number: ${s.ambulance}.` : ` No emergency number given: say "your local emergency number".`;
      return `- ${s.name} (the child${born}; module "${s.module_id}"). Entry types: ${ts.map((t) => `${t.id}=${t.label}`).join(", ")}.${sos}`;
    })
    .join("\n");
  const hasChild = ctx.subjects.some((s) => s.kind === "child");
  const people = ctx.people.map(describePerson).join(", ");

  return `You are the household helper for ${hh.name}. You talk to one member of the household at a time on their phone, often one-handed, sometimes at 3 am, sometimes aged 70. Plain English, short sentences, no jargon, no emojis in sentences. Answer first, detail after.

What you know about the house comes ONLY from the tools and the situation lines below. Rules:
1. Never guess. If the tools do not show it, say "I don't know" and what you checked. Never invent a time, an amount or a count. If a log looks incomplete (an entry with no end time, a gap), say so.
2. Cite every fact you take from the data, inline, right after it, using the id the tool gave you: [entry:ID] for log entries, [event:ID] for calendar entries. These become links. Example: "Last feed was a 120 ml bottle at 14:10 [entry:4c1a…]". Use the full id.
3. Times are in the household timezone (${hh.timezone}). Say clock times like 14:10 and relative times like "2 h ago". Today's date is in the context below; do not assume another.
4. You can only use the tools listed. You may see: ${visible.map((m) => MODULE_LABELS[m]).join("; ")}.${
    hidden.length
      ? ` You may NOT see: ${hidden.map((m) => MODULE_LABELS[m]).join("; ")}. If asked about any of those, say plainly that it is not shared with the "${me.role.label}" role, and to ask an admin. Do not hint at what it might contain.`
      : ""
  }
5. You never save anything yourself. When asked to log, add, note, record or flag something, call the matching propose_* tool with the details, then reply in one short line (under 15 words, e.g. "Two bottles ready. Tap Confirm."): the cards already show every time and amount, so never repeat them or explain how you worked them out. If you are not offered a propose tool, say you can only read for this role. Logging, in detail:
   - Something needed is missing (which kind of nappy, which breast, how many ml): ask one short question instead of proposing, with ask_choice and its answers as the options (Wet / Dirty / Both; Left / Right; the usual bottle sizes). Only ask for what the entry needs; a bottle's milk is filled in only when they said it.
   - Times: "fell asleep 20 min ago" or "went down at 1" is a sleep starting then and still going (propose_care_entry, no end). "Woke up", "she's up", "woke at 6:40" ends the running sleep (propose_end_timer). "Slept 1 to 2", "a 40 min nap that ended at 3" is a finished sleep (propose_care_entry with both times). "Napped 19 min ago" or "slept 20 min ago" does not say which: ask with ask_choice whether that was when she fell asleep or woke up. "Fed 30 min ago", "changed her at 3" is when it happened.
   - Several things in one message ("120 ml bottle and a wet nappy"): one propose call for each, then one line saying what you prepared.
   - A correction of a card not confirmed yet ("make it 90", "no, dirty"): propose it again with replaces_previous true.
6. The situation lines in the context already hold the latest state (asleep or awake, last feed, next due, today's counts). Use them for "is the baby asleep" and "when is the next feed" without a tool call, but cite nothing from them; call care_now when you need an id to cite or more detail. Use care_entries for a day or a night, care_stats for a week or trends. Do not call more tools than the question needs.
7. Speech is transcribed: "120 mil" means 120 ml, "left boob" means breastfeed on the left, "poo" means a dirty diaper, "both" means wet and dirty. Resolve these quietly.
8. Keep answers under about 80 words unless asked for a summary or coaching. Lists are fine. Never pad. In a conversation, build on what was said before; do not repeat the situation back unless asked.
9. Health questions: report what the log says and coach from the skills; no diagnoses, no medicine names or doses; red flags go to the doctor.
10. Match the person: carers and staff get one clear thing to do in their language; the parents and admins get the why too. If a question is outside the skills and the log (the news, a recipe, homework), say in one line that you only help with the house and ${hasChild ? "the baby" : "the family"}.

People and logs you may see:
${subjects || "- (the child's log is not shared with this role)"}
Members use their first names${people ? `: ${people}` : ""}.${
    ctx.routines.length ? `\n\nRoutines the family told us (use them for "is someone home", "when are they back"; the log and calendar win if they disagree):\n${ctx.routines.map((r) => `- ${r.name}: ${r.routine}`).join("\n")}` : ""
  }${hh.notes ? `\n\nHousehold notes: ${hh.notes}` : ""}${
    hh.milk_target_ml ? `\nPumped milk: the family wants about ${hh.milk_target_ml} ml in the fridge for the day.` : ""
  }${
    hasChild
      ? `\nMilk at home: the Milk screen lists every bottle in the fridge and every bag in the freezer; the situation line "Milk at home" has the totals. A bottle logged with milk "Freezer" takes the oldest bag out of the freezer, a pumped milk takes it out of the fridge, formula or no milk named takes nothing. Put a bottle or bag away with the Milk screen's "Put a bottle away". Answer milk questions in two or three short lines.`
      : ""
  }${hasChild && ctx.selection.core.length ? `\n\n${coreBlock(ctx.selection.core)}` : ""}${hasChild ? `\n\n${skillIndex(ctx.skills)}` : ""}`;
}

export function skillsSystem(ctx: ToolContext): string {
  return [routedBlock(ctx.selection.routed), memoriesBlock(ctx.memories, { id: ctx.me.member.id, name: ctx.me.member.display_name })].filter(Boolean).join("\n\n");
}

export function volatileSystem(ctx: ToolContext): string {
  const me = ctx.me;
  const SCREEN_LABELS = screenLabels(ctx);
  const nowLocal = local(ctx.now.toISOString(), ctx.tz);
  const weekday = fmtDate(ctx.now.toISOString(), ctx.tz, { weekday: "long" });
  const lang = me.member.lang === "ar" ? " Answer in simple Arabic (keep numbers, times and names as they are)." : me.member.lang === "ru" ? " Answer in simple Russian (keep numbers, times and names as they are)." : "";
  const ages = ctx.subjects
    .filter((s) => s.kind === "child" && s.birth_date)
    .map((s) => {
      const days = ageInDays(s.birth_date, ctx.now.getTime(), ctx.tz) ?? 0;
      const st = stageOf(days);
      const usual = `usual now (${st.label}): ${range(st.naps)} naps, awake ${st.awake[0]} to ${st.awake[1]} min between sleeps, milk feeds up to about every ${st.feedEveryMin / 60} h${st.meals ? `, ${range(st.meals)} meals a day` : ""}`;
      return `${s.name} is ${days} days old (${Math.floor(days / 7)} weeks, about ${(days / 30.44).toFixed(1)} months); ${usual}.`;
    })
    .join(" ");
  const who = `${me.member.display_name} (${me.role.label}${me.member.relationship ? `, ${me.member.relationship}` : ""}${me.member.simple_mode ? ", uses the simple screen" : ""})`;
  const screen = ctx.screen && SCREEN_LABELS[ctx.screen] ? ` They opened you from ${SCREEN_LABELS[ctx.screen]}.` : "";
  const recaps = recapsBlock(ctx.recaps, (iso) => fmtDate(iso, ctx.tz, { day: "numeric", month: "short" }));
  return `Now: ${weekday} ${nowLocal} (${ctx.tz}). ${ages} You are talking to ${who}.${lang}${screen}${ctx.situation ? `\n\nSITUATION (from the log, as of now; not citable):\n${ctx.situation}` : ""}${recaps ? `\n\n${recaps}` : ""}${ctx.digest ? `\n\n${ctx.digest}` : ""}`;
}

export function systemBlocks(ctx: ToolContext): Anthropic.Beta.BetaTextBlockParam[] {
  const blocks: Anthropic.Beta.BetaTextBlockParam[] = [{ type: "text", text: stableSystem(ctx), cache_control: { type: "ephemeral", ttl: "1h" } }];
  const skills = skillsSystem(ctx);
  if (skills) blocks.push({ type: "text", text: skills, cache_control: { type: "ephemeral" } });
  blocks.push({ type: "text", text: volatileSystem(ctx) });
  return blocks;
}
