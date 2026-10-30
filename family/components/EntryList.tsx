"use client";
import { useState } from "react";
import type { EntryRow, EntryType } from "@/lib/types";
import { describePayload, fmtDuration, fmtTime } from "@/lib/time";
import { tintFor } from "@/lib/tints";
import { EntrySheet } from "./EntrySheet";

/** How long an entry lasted, minutes; none for a bottle (logged with its end at its start). */
export function lastedMin(e: Pick<EntryRow, "occurred_at" | "ended_at">): number | null {
  return e.ended_at ? Math.round((Date.parse(e.ended_at) - Date.parse(e.occurred_at)) / 60_000) || null : null;
}

/**
 * The day's entries as a timeline list (time, icon, what, who). Tapping one opens its edit
 * sheet in place (EntrySheet), never a separate page.
 */
export function EntryList({ entries, types, timezone, canEdit, canDelete }: { entries: EntryRow[]; types: EntryType[]; timezone: string; canEdit: boolean; canDelete: boolean }) {
  const [open, setOpen] = useState<EntryRow | null>(null);
  return (
    <>
      <ul className="card flex flex-col p-0">
        {entries.map((e) => {
          const len = lastedMin(e);
          return (
            <li key={e.id} className="row px-4">
              <button type="button" className="flex min-h-[44px] w-full items-center gap-3 text-left" onClick={() => setOpen(e)}>
                <span className="w-12 shrink-0 font-semibold tabular-nums">{fmtTime(e.occurred_at, timezone)}</span>
                <span aria-hidden className={`icon-disc tint-${tintFor(e.type_id.split(".")[1])} text-lg`} style={{ width: 32, height: 32 }}>
                  {e.icon}
                </span>
                <span className="min-w-0 flex-1">
                  {/* How long on the first line ("Sleep · 45 min"), when it ended on the second. */}
                  <span className="block truncate font-semibold">
                    {e.type_label}
                    {len ? <span className="muted font-normal"> · {fmtDuration(len)}</span> : !e.ended_at && e.type_id === "lana.sleep" ? <span className="muted font-normal"> still asleep</span> : null}
                  </span>
                  <span className="muted block truncate text-sm">{[len ? `until ${fmtTime(e.ended_at!, timezone)}` : null, describePayload(e.payload), e.note, e.attributed_name ?? e.logged_by_name].filter(Boolean).join(" · ")}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {open && <EntrySheet key={open.id} entry={open} type={types.find((t) => t.id === open.type_id)} timezone={timezone} canEdit={canEdit} canDelete={canDelete} onClose={() => setOpen(null)} />}
    </>
  );
}
