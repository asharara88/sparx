"use client";
import { useCallback, useState } from "react";
import Link from "next/link";
import type { EntryRow, EntryType } from "@/lib/types";
import { can } from "@/lib/types";
import { useMe } from "@/lib/me-context";
import { tintFor } from "@/lib/tints";
import { Sheet } from "./Sheet";
import { MoodTap } from "./MoodTap";
import { Backfill } from "./Backfill";
import { Icon } from "./Icon";

/**
 * "+ Log", the child's page's one bottom button (DESIGN.md, "The child's page"). It opens a
 * sheet: how she is right now (one tap), every kind of entry as a row, and "From earlier"
 * for something that was missed. Home keeps the four most common as tiles.
 */
export function LogMenu({ subjectId, types, timezone, day, isToday, entries, todayEntries, feedIntervalMin }: { subjectId: string; types: EntryType[]; timezone: string; day: string; isToday: boolean; entries: EntryRow[]; todayEntries: EntryRow[]; feedIntervalMin: number }) {
  const me = useMe();
  const [open, setOpen] = useState<"menu" | "earlier" | null>(null);
  const close = useCallback(() => setOpen(null), []);
  if (!can(me, "lana", "add")) return null;
  return (
    <>
      <div className="bottom-action">
        <button type="button" className="btn btn-primary btn-lg w-full" onClick={() => setOpen(isToday ? "menu" : "earlier")}>
          <Icon name="plus" size={20} /> {isToday ? "Log" : "Add to this day"}
        </button>
      </div>
      {open === "menu" && (
        <Sheet title="Log" onClose={close}>
          <MoodTap bare subjectId={subjectId} today={todayEntries} timezone={timezone} />
          <ul className="card flex flex-col p-0">
            {types
              .filter((t) => t.key !== "mood")
              .map((t) => (
                <li key={t.id} className="row px-4">
                  <Link href={`/baby/log/${t.key}`} className="row-link flex min-h-[44px] w-full items-center gap-3">
                    <span aria-hidden className={`icon-disc tint-${tintFor(t.key)} text-xl`} style={{ width: 36, height: 36 }}>
                      {t.icon}
                    </span>
                    <span className="flex-1 font-semibold">{t.label}</span>
                    <Icon name="forward" size={18} className="muted" />
                  </Link>
                </li>
              ))}
            <li className="row px-4">
              <button type="button" className="flex min-h-[44px] w-full items-center gap-3 text-left" onClick={() => setOpen("earlier")}>
                <span aria-hidden className="icon-disc" style={{ width: 36, height: 36 }}>
                  <Icon name="history" size={20} />
                </span>
                <span className="flex-1 font-semibold">From earlier</span>
                <Icon name="forward" size={18} className="muted" />
              </button>
            </li>
          </ul>
        </Sheet>
      )}
      {open === "earlier" && (
        <Sheet title={isToday ? "From earlier" : "Add to this day"} onClose={close}>
          <Backfill bare defaultOpen onSaved={close} subjectId={subjectId} types={types} timezone={timezone} day={day} entries={entries} feedIntervalMin={feedIntervalMin} />
        </Sheet>
      )}
    </>
  );
}
