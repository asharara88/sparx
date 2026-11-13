import type { EntryRow, EntryType } from "@/lib/types";
import { Fold } from "@/components/Fold";
import { EntryList } from "@/components/EntryList";
import { byDay, dayLabel } from "@/lib/by-day";
import { ymdInZone } from "@/lib/time";

/**
 * Every entry of a kind for the last week, by day: today's open, the days before as one quiet
 * list of flat folds, one per day (quieter than today, not six tinted cards). Tapping an entry
 * opens it to change or delete (EntrySheet). The Sleep and Feed sections use it.
 */
export function DayEntries({ entries, types, timezone, today, canEdit, canDelete, noun }: { entries: EntryRow[]; types: EntryType[]; timezone: string; today: string; canEdit: boolean; canDelete: boolean; noun: [string, string] }) {
  const days = byDay(entries, (iso) => ymdInZone(new Date(iso), timezone));
  const first = days[0]?.day === today ? days[0] : null;
  const rest = first ? days.slice(1) : days;
  const count = (n: number) => `${n} ${n === 1 ? noun[0] : noun[1]}`;
  return (
    <section className="flex flex-col gap-2" aria-label={`Every ${noun[0]}`}>
      <h2 className="section-title px-1">Today{first ? `, ${count(first.entries.length)}` : ""}</h2>
      {first ? <EntryList entries={first.entries} types={types} timezone={timezone} canEdit={canEdit} canDelete={canDelete} /> : <p className="muted px-1 text-sm">None logged yet today.</p>}
      {rest.length > 0 && (
        <>
          <h2 className="section-title mt-2 px-1">Earlier this week</h2>
          <div className="card flex flex-col p-0">
            {rest.map((d) => (
              <Fold key={d.day} className="fold-flat" title={dayLabel(d.day, today)} hint={count(d.entries.length)}>
                <EntryList bare entries={d.entries} types={types} timezone={timezone} canEdit={canEdit} canDelete={canDelete} />
              </Fold>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
