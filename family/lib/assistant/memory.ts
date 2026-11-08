import type { AssistantProposal, AssistantTurn } from "../types";

/**
 * Memory selection. The helper has four kinds of memory:
 *  - facts the family confirmed (assistant_memories): about the home, a child
 *    or a person, each a sentence; the prompt gets the ones that matter for
 *    this question, and always the ones about the person asking;
 *  - what the helper noticed in earlier chats and nobody has confirmed yet
 *    (the same table, status "suggested"): offered with care, never as fact;
 *  - recaps of the member's own earlier chats (ask_chats.summary): episodic,
 *    newest first, so a follow-up a week later starts where it ended;
 *  - outcomes of coach plans, which the situation snapshot carries.
 * Pure, so it is unit-tested.
 */

export type MemoryKind = "home" | "child" | "person";

export interface MemoryFact {
  id: string;
  body: string;
  kind?: MemoryKind;
  status?: "kept" | "suggested";
  about?: { id: string; name: string } | null;
  subject?: { id: string; name: string } | null;
  expires_at?: string | null;
  created_at?: string;
  by?: string | null;
}

export interface ChatRecap {
  id: string;
  title: string;
  summary: string | null;
  at: string;
}

const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "on", "at", "for", "is", "it", "she", "her", "he", "his", "we", "you", "i", "my", "our", "with", "when", "what", "how", "does", "do", "did", "was", "were", "be", "been", "that", "this", "than", "then", "there", "about", "not", "no", "so", "if", "but", "can", "should", "would"]);

/**
 * A Title-case word that does not open a sentence is read as a name ("When did
 * Lana last feed?"), so the household's names never have to be listed in code.
 * Acronyms (NHS) and sentence openers are kept.
 */
function looksLikeName(raw: string, text: string, at: number): boolean {
  if (!/^\p{Lu}\p{Ll}+$/u.test(raw)) return false;
  const before = text.slice(0, at).trimEnd();
  return before.length > 0 && !/[.!?؟…:\n]$/.test(before);
}

/**
 * The words that carry meaning: lower-cased, with stop words and names dropped.
 * `names` are the household's subjects and members when the caller has them;
 * without them, names are guessed from their capitals.
 */
export function words(text: string, names: Iterable<string> = []): string[] {
  const skip = new Set(Array.from(names, (n) => n.toLowerCase()));
  const out: string[] = [];
  const re = /[\p{L}\p{N}]{2,}/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const w = m[0].toLowerCase();
    if (STOP.has(w) || skip.has(w) || looksLikeName(m[0], text, m.index)) continue;
    out.push(w);
  }
  return out;
}

/** Word-prefix overlap, so "naps" meets "nap" and "feeding" meets "feed". */
function overlap(a: string[], b: Set<string>): number {
  let n = 0;
  for (const w of a) {
    for (const x of b) {
      if (x === w || (w.length >= 4 && x.startsWith(w.slice(0, 4))) || (x.length >= 4 && w.startsWith(x.slice(0, 4)))) {
        n++;
        break;
      }
    }
  }
  return n;
}

export const MAX_FACTS = 30;
export const MAX_SUGGESTED = 5;

/**
 * Which facts go into the prompt. All of them while there are few; past the
 * cap, the ones about the person asking always, then the ones that share words
 * with the question and the last turns, then the newest (memory_list returns
 * newest first). Suggestions (unconfirmed) are capped separately and come last.
 */
export function selectMemories(question: string, history: string[], facts: MemoryFact[], max = MAX_FACTS, names: Iterable<string> = [], askerId: string | null = null): MemoryFact[] {
  const kept = facts.filter((f) => f.status !== "suggested");
  const suggested = facts.filter((f) => f.status === "suggested").slice(0, MAX_SUGGESTED);
  if (kept.length <= max) return [...kept, ...suggested];
  const skip = Array.from(names);
  const q = new Set(words([question, ...history.slice(-2)].join(" "), skip));
  const picked = [...kept]
    .map((f, i) => ({ f, score: (askerId && f.about?.id === askerId ? 1000 : 0) + overlap(words(f.body, skip), q) * 10 + (kept.length - i) / kept.length }))
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.f);
  return [...picked, ...suggested];
}

/**
 * The prompt's memory block, grouped by what each memory is about: the home,
 * each child, each person (the person asking first, named as such). The id in
 * brackets is for forget_memory. Suggestions come last, marked as unconfirmed.
 */
export function memoriesBlock(facts: MemoryFact[], asker: { id: string; name: string } | null): string {
  if (!facts.length) return "";
  const line = (f: MemoryFact) => `- [${f.id.slice(0, 8)}] ${f.body}`;
  const kept = facts.filter((f) => f.status !== "suggested");
  const suggested = facts.filter((f) => f.status === "suggested");
  const groups: { title: string; items: MemoryFact[] }[] = [];
  const home = kept.filter((f) => !f.kind || f.kind === "home");
  if (home.length) groups.push({ title: "About the home", items: home });
  const bySubject = new Map<string, { name: string; items: MemoryFact[] }>();
  for (const f of kept.filter((f) => f.kind === "child")) {
    const k = f.subject?.id ?? "?";
    if (!bySubject.has(k)) bySubject.set(k, { name: f.subject?.name ?? "the child", items: [] });
    bySubject.get(k)!.items.push(f);
  }
  for (const g of bySubject.values()) groups.push({ title: `About ${g.name}`, items: g.items });
  const byPerson = new Map<string, { name: string; items: MemoryFact[] }>();
  for (const f of kept.filter((f) => f.kind === "person")) {
    const k = f.about?.id ?? "?";
    if (!byPerson.has(k)) byPerson.set(k, { name: f.about?.name ?? "someone", items: [] });
    byPerson.get(k)!.items.push(f);
  }
  const people = [...byPerson.entries()].sort(([a], [b]) => (a === asker?.id ? -1 : b === asker?.id ? 1 : 0));
  for (const [id, g] of people) groups.push({ title: `About ${g.name}${id === asker?.id ? " (the person you are talking to)" : ""}`, items: g.items });
  const out = [
    "Things the family asked you to remember (follow them; they are not log data, so do not cite them; the id in brackets is for forget_memory):",
    ...groups.map((g) => `${g.title}:\n${g.items.map(line).join("\n")}`),
  ];
  if (suggested.length) out.push(`Things you noticed in earlier chats that nobody has confirmed yet (treat as likely, not certain; say "I think" if you lean on one; the family keeps or drops them on the memory screen):\n${suggested.map(line).join("\n")}`);
  return out.join("\n\n");
}

/**
 * The messages sent back to the model carry what happened to each proposal
 * card, so a follow-up knows the bottle was logged and the memory kept, or not.
 */
export function withOutcomes(msgs: { role: "user" | "assistant"; text: string; proposals?: AssistantProposal[]; error?: boolean; streaming?: boolean }[], states: Record<string, { status: string; note?: string }>): AssistantTurn[] {
  return msgs
    .filter((m) => !m.error && !m.streaming)
    .map((m) => {
      const lines = (m.proposals ?? []).map((p) => {
        const s = states[p.id]?.status;
        return `[${s === "saved" ? "Confirmed and saved" : s === "replaced" ? "Replaced by a corrected card" : s === "dropped" || s === "error" ? "Not saved" : "Not confirmed yet"}: ${p.summary}]`;
      });
      return { role: m.role, text: lines.length ? `${m.text}\n${lines.join("\n")}`.trim() : m.text };
    });
}

/**
 * A long chat is cut to its last turns before it reaches the model; the earlier
 * part comes along as one line per question asked, so the thread still makes
 * sense ("the bottle we talked about"). Empty when nothing was cut.
 */
export function chatDigest(turns: AssistantTurn[], keep: number, maxLines = 10): string {
  if (turns.length <= keep) return "";
  const dropped = turns.slice(0, turns.length - keep);
  const asked = dropped.filter((t) => t.role === "user").map((t) => t.text.replace(/\s+/g, " ").trim().slice(0, 100));
  const confirmed = dropped.flatMap((t) => [...t.text.matchAll(/\[Confirmed and saved: ([^\]]+)\]/g)].map((m) => m[1].slice(0, 100)));
  const lines = [...asked.slice(-maxLines).map((q) => `- asked: ${q}`), ...confirmed.slice(-5).map((c) => `- saved: ${c}`)];
  return lines.length ? `EARLIER IN THIS CHAT (cut for length; what they asked and what was saved):\n${lines.join("\n")}` : "";
}

/** The recap line saved with a chat: the first question and where the last answer landed, citations stripped. */
export function recapOf(firstQuestion: string, lastAnswer: string): string {
  const q = firstQuestion.trim().replace(/\s+/g, " ").slice(0, 120);
  const a = lastAnswer
    .replace(/\s*\[[a-z]+:[^\]]+\]/g, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  // The first sentence or two of the answer, up to about 220 characters.
  const sentences = a.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) ?? [a];
  let cut = "";
  for (const s of sentences.slice(0, 2)) {
    const next = `${cut} ${s.trim()}`.trim();
    if (cut && next.length > 220) break;
    cut = next;
  }
  if (!cut) cut = a;
  if (cut.length > 220) cut = `${cut.slice(0, 217).trimEnd()}…`;
  return `${q} → ${cut}`.slice(0, 400);
}

/** The prompt block for a member's earlier chats; empty when there are none. */
export function recapsBlock(recaps: ChatRecap[], dayOf: (iso: string) => string): string {
  const lines = recaps.filter((r) => r.summary).slice(0, 6).map((r) => `- ${dayOf(r.at)}: ${r.summary}`);
  return lines.length ? `EARLIER CHATS with this person (newest first; your memory of what they asked and what you said; not citable):\n${lines.join("\n")}` : "";
}
