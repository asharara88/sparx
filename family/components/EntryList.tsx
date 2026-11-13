"use client";
import { useState } from "react";
import type { EntryRow, EntryType } from "@/lib/types";
import { entryDetail, fmtDuration, fmtTime } from "@/lib/time";
import { iconFor, tintFor } from "@/lib/tints";
import { Icon } from "./Icon";
import { EntrySheet } from "./EntrySheet";

/** How long an entry lasted, minutes; none for a bottle (logged with its end at its start). */
export function lastedMin(e: Pick<EntryRow, "occurred_at" | "ended_at">): number | null {
  return e.ended_at ? Math.round((Date.parse(e.ended_at) - Date.parse(e.occurred_at)) / 60_000) || null : null;
}

/**
 * The day's entries as a timeline list (time, icon, what, who). Tapping one opens its edit
 * sheet in place (EntrySheet), never a separate page.
 */
export function EntryList({ entries, types, timezone, canEdit, canDelete, bare = false }: { entries: EntryRow[]; types: EntryType[]; timezone: string; canEdit: boolean; canDelete: boolean; /** Inside a fold: no card of its own (a card in a card). */ bare?: boolean }) {
  const [open, setOpen] = useState<EntryRow | null>(null);
  return (
    <>
      <ul className={`${bare ? "" : "card "}flex flex-col p-0`}>
        {entries.map((e) => {
          const len = lastedMin(e);
          const key = e.type_id.split(".")[1];
          const icon = iconFor(key);
          const detail = entryDetail(e.payload, !!len);
          const running = !e.ended_at && e.type_id === "lana.sleep";
          return (
            <li key={e.id} className={bare ? "row" : "row px-4"}>
              {/* DESIGN.md, list rows: the time and what, the detail and who under it ("Left breast ·
                  Dana"), and the row's one number, how long, on the right. When it ended is in the sheet. */}
              <button type="button" className="flex w-full items-center gap-3 text-left" onClick={() => setOpen(e)}>
                <span className="w-12 shrink-0 font-semibold tabular-nums">{fmtTime(e.occurred_at, timezone)}</span>
                <span aria-hidden className={`icon-disc tint-${tintFor(key)} ${icon ? "" : "text-lg"}`} style={{ width: 32, height: 32 }}>
                  {icon ? <Icon name={icon} size={17} /> : e.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{e.type_label}</span>
                  <span className="muted block truncate text-sm">{[detail, e.note, e.attributed_name ?? e.logged_by_name].filter(Boolean).join(" · ")}</span>
                </span>
                {len ? <span className="shrink-0 font-semibold tabular-nums">{fmtDuration(len)}</span> : running ? <span className="muted shrink-0 font-semibold">now</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
      {open && <EntrySheet key={open.id} entry={open} type={types.find((t) => t.id === open.type_id)} timezone={timezone} canEdit={canEdit} canDelete={canDelete} onClose={() => setOpen(null)} />}
    </>
  );
}
