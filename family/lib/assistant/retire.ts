import type { AssistantProposal } from "../types";

/** What happened to a proposal card: kept in the chat and in session storage. */
export type ProposalState = { status: "pending" } | { status: "saving" } | { status: "saved"; href?: string; note: string } | { status: "dropped" } | { status: "error"; message: string };

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
