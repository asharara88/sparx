/**
 * What the helper notices in a chat and offers as a memory, without being
 * asked. The pure half: when a chat is worth reading, how the model's answer
 * is parsed, and which candidates are new. remember-run.ts does the model
 * call and the save; the route wires it to a chat. Nothing here writes.
 */

export interface MemoryCandidate {
  body: string;
  kind: "home" | "child" | "person";
  /** The member's or child's name as the model wrote it; the caller maps it to an id. */
  about?: string | null;
}

/** A chat is read once it has two new questions since the last read. */
export function shouldMine(userTurns: number, minedTurns: number): boolean {
  return userTurns >= 2 && userTurns >= minedTurns + 2;
}

/** The model answers with a JSON array; tolerate prose around it and a code fence. */
export function parseCandidates(text: string): MemoryCandidate[] {
  const m = /\[[\s\S]*\]/.exec(text);
  if (!m) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(m[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: MemoryCandidate[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const body = String((x as { body?: unknown }).body ?? "")
      .replace(/\s+/g, " ")
      .trim();
    const kind = String((x as { kind?: unknown }).kind ?? "home");
    const about = (x as { about?: unknown }).about;
    if (body.length < 8 || body.length > 300) continue;
    if (kind !== "home" && kind !== "child" && kind !== "person") continue;
    out.push({ body, kind, about: typeof about === "string" && about.trim() ? about.trim() : null });
  }
  return out.slice(0, 3);
}

const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "on", "at", "for", "is", "it", "she", "her", "he", "his", "they", "them", "their", "we", "you", "i", "my", "our", "with", "when", "that", "this", "be", "not", "no", "so"]);
/** The words that carry meaning, lower-cased (no sibling import: the unit tests load this file on its own). */
function words(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []).filter((w) => !STOP.has(w));
}

/** Word overlap as a share of the shorter sentence: 0 to 1. */
function similarity(a: string, b: string): number {
  const wa = new Set(words(a));
  const wb = new Set(words(b));
  if (!wa.size || !wb.size) return 0;
  let n = 0;
  for (const w of wa) if (wb.has(w)) n++;
  return n / Math.min(wa.size, wb.size);
}

/** Drop a candidate that says what a memory (kept, suggested, or dropped by the family) already says, or repeats another candidate. */
export function newCandidates(cands: MemoryCandidate[], existing: string[], threshold = 0.7): MemoryCandidate[] {
  const out: MemoryCandidate[] = [];
  for (const c of cands) {
    const seen = [...existing, ...out.map((o) => o.body)];
    if (seen.some((e) => e.toLowerCase() === c.body.toLowerCase() || similarity(e, c.body) >= threshold)) continue;
    out.push(c);
  }
  return out;
}

/** The instruction for the reading model. Short on purpose: it runs after every chat. */
export function rememberPrompt(opts: { people: string[]; children: string[]; existing: string[] }): string {
  return `You read a finished chat between a household helper and one member of the family, and pick out what is worth remembering for later chats with anyone in the house. Return ONLY a JSON array, up to 3 items, each {"body": "...", "kind": "home"|"child"|"person", "about": name or null}. Rules:
- A memory is a durable fact or preference, said by the member, not by the helper: what works for the child (sleeps better with white noise), the family's approach (no cry-it-out), a fixed habit or schedule, how someone likes answers (short, in Arabic), a new tooth or milestone, a decision made in the chat (bedtime moved to 19:00 from Monday).
- Not one-off events (she fed at 14:10), not what the log already holds, not questions, not the helper's advice unless the member agreed to try it, not health details beyond what the member stated as fact.
- "kind": "child" when it is about a child (then "about" is the child's name: ${opts.children.join(", ") || "none"}); "person" when about a member (then "about" is their first name: ${opts.people.join(", ") || "none"}); otherwise "home" with "about" null.
- One plain sentence each, under 200 characters, in English, present tense, naming who or what it is about.
- Skip anything already remembered: ${opts.existing.length ? opts.existing.map((e) => JSON.stringify(e)).join("; ") : "(nothing yet)"}.
- If nothing qualifies, return [].`;
}
