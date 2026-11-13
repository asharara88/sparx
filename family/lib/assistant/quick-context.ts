import type { EntryType, HomeSummary, Me, OngoingEntry, RpcError } from "@/lib/types";
import { can } from "@/lib/types";

/**
 * What a screen needs to save plain logs on the phone ("120 ml bottle", "wet nappy"): the one
 * child, her feed, diaper and sleep types, any running sleep, and whether Undo may delete.
 * Built on the server from home_summary (Home and Ask), read by the Assistant. Not in a
 * "use client" file, so server pages can call it.
 */
export interface QuickContext {
  subjectId: string;
  subjectName: string;
  types: EntryType[];
  ongoing: OngoingEntry[];
  canDelete: boolean;
}

/** Null when the member may not add to the log, or the home has more than one child (the helper asks whose). */
export function quickContextOf(summary: HomeSummary | RpcError | null | undefined, me: Me): QuickContext | null {
  if (!summary || !summary.ok || !can(me, "lana", "add") || (me.subjects?.length ?? 1) > 1) return null;
  return {
    subjectId: summary.subject.id,
    subjectName: summary.subject.name,
    types: summary.types.filter((t) => ["feed", "diaper", "sleep"].includes(t.key)),
    ongoing: summary.ongoing,
    canDelete: can(me, "lana", "delete"),
  };
}
