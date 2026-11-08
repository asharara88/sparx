import type { AssistantProposal } from "../types";

/** What happened to a proposal card: kept in the chat and in session storage. */
export type ProposalState = { status: "pending" } | { status: "saving" } | { status: "saved"; href?: string; note: string } | { status: "dropped" } | { status: "replaced" } | { status: "error"; message: string };

const KINDS = new Set<string>(["care_entry", "end_timer", "calendar_event", "plan", "memory", "forget"]);
const GONE = /^\/(shopping|house)(\/|$)/;

/**
 * A chat saved before an area left the app (shopping, the house) may still carry
 * its proposal cards. One of a kind the app no longer has cannot be confirmed:
 * a pending, saving or failed card is shown as not saved, and a saved card keeps
 * its note but loses a link to a screen that is gone. Cards of a living kind are
 * left alone, except for such a link.
 */
export function retireProposals(msgs: { proposals?: AssistantProposal[] }[], states: Record<string, ProposalState>): Record<string, ProposalState> {
  const out: Record<string, ProposalState> = { ...states };
  for (const m of msgs) {
    for (const p of m.proposals ?? []) {
      const s = out[p.id];
      if (KINDS.has(p.kind)) {
        if (s?.status === "saved" && s.href && GONE.test(s.href)) out[p.id] = { status: "saved", note: s.note };
        continue;
      }
      out[p.id] = s?.status === "saved" ? { status: "saved", note: s.note } : { status: "dropped" };
    }
  }
  return out;
}

/** What a card is about, for matching a correction to the card it corrects: its entry type, else its kind. */
const aboutOf = (p: AssistantProposal) => p.care_entry?.type_id ?? p.end_timer?.type_id ?? p.kind;

/**
 * A corrected card ("make it 90") takes the place of the latest earlier card about the same
 * thing that is not saved yet (waiting for Confirm, or its save failed and Try again is
 * showing); that one is marked replaced so it cannot be confirmed too. Cards saved, being
 * saved, dropped or replaced are left alone.
 */
export function replacedBy(msgs: { proposals?: AssistantProposal[] }[], fresh: AssistantProposal[], states: Record<string, ProposalState>): string[] {
  const out: string[] = [];
  const earlier = msgs.flatMap((m) => m.proposals ?? []);
  for (const p of fresh.filter((x) => x.replaces)) {
    const target = [...earlier].reverse().find((q) => aboutOf(q) === aboutOf(p) && ["pending", "error"].includes(states[q.id]?.status ?? "pending") && !out.includes(q.id));
    if (target) out.push(target.id);
  }
  return out;
}
