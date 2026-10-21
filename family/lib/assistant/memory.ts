/**
 * Memory selection. The helper has three kinds of memory:
 *  - facts the family confirmed (assistant_memories): household-wide, each a
 *    sentence; the prompt gets the ones that matter for this question;
 *  - recaps of the member's own earlier chats (ask_chats.summary): episodic,
 *    newest first, so a follow-up a week later starts where it ended;
 *  - outcomes of coach plans, which the situation snapshot carries.
 * Pure, so it is unit-tested.
 */

export interface MemoryFact {
  id: string;
  body: string;
  created_at?: string;
  by?: string | null;
}

export interface ChatRecap {
  id: string;
  title: string;
  summary: string | null;
  at: string;
}

const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "on", "at", "for", "is", "it", "she", "her", "he", "his", "we", "you", "i", "my", "our", "with", "when", "what", "how", "does", "do", "did", "was", "were", "be", "been", "that", "this", "than", "then", "there", "about", "not", "no", "so", "if", "but", "can", "should", "would", "lana"]);

export function words(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []).filter((w) => !STOP.has(w));
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

/**
 * Which confirmed facts go into the prompt. All of them while there are few;
 * past the cap, the ones that share words with the question and the last turns
 * come first, then the newest (memory_list returns newest first).
 */
export function selectMemories(question: string, history: string[], facts: MemoryFact[], max = MAX_FACTS): MemoryFact[] {
  if (facts.length <= max) return facts;
  const q = new Set(words([question, ...history.slice(-2)].join(" ")));
  return [...facts]
    .map((f, i) => ({ f, score: overlap(words(f.body), q) * 10 + (facts.length - i) / facts.length }))
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.f);
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
