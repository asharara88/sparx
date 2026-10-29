"use client";
import { useState } from "react";
import { AGO_PRESETS, agoLabel, clockMarks, MARK_COUNT, NOW, type When } from "@/lib/when";
import { toLocalInput } from "@/lib/time";

/**
 * "When?" for logging after the fact: now, or a clock time from the last two hours on a
 * ten-minute grid (13:50, 13:40, …), or any time with the picker. Clock times, not "80 min
 * ago", so it matches the clock on the wall. Collapsed to one line until tapped, so the
 * one-tap screen stays one tap; picking a time folds it back to that line.
 */
export function WhenChips({ value, onChange, timezone, marks = MARK_COUNT, label = "When", disabled = false, alwaysOpen = false, defaultOpen = false }: { value: When; onChange: (w: When) => void; timezone: string; marks?: number; label?: string; disabled?: boolean; alwaysOpen?: boolean; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(alwaysOpen || defaultOpen);
  // "At a time…" was tapped: the picker shows, whatever time it holds.
  const [custom, setCustom] = useState(false);
  const summary = value.kind === "now" ? "now" : value.kind === "ago" ? agoLabel(value.min) : `at ${value.local.slice(11)}${value.local.slice(0, 10) !== toLocalInput(new Date().toISOString(), timezone).slice(0, 10) ? ` on ${value.local.slice(5, 10)}` : ""}`;
  if (!open) {
    return (
      <button type="button" className={`chip self-start text-sm ${value.kind !== "now" ? "" : "muted"}`} aria-pressed={value.kind !== "now"} disabled={disabled} onClick={() => setOpen(true)}>
        {label}: {summary} {value.kind === "now" ? "· earlier?" : "· change"}
      </button>
    );
  }
  const pick = (w: When) => {
    onChange(w);
    setCustom(false);
    if (!alwaysOpen) setOpen(false);
  };
  const times = clockMarks(Date.now(), (iso) => toLocalInput(iso, timezone), marks);
  // The picker shows once asked for, or for a time no chip holds (a past day's noon).
  const picker = custom || (value.kind === "at" && !times.includes(value.local));
  return (
    <div className="flex flex-col gap-2" role="group" aria-label={label}>
      <div className="grid grid-cols-4 gap-2">
        <button type="button" className="chip px-0" aria-pressed={value.kind === "now"} disabled={disabled} onClick={() => pick(NOW)}>
          Now
        </button>
        {times.map((local) => (
          <button key={local} type="button" className="chip px-0 tabular-nums" aria-pressed={value.kind === "at" && value.local === local} disabled={disabled} onClick={() => pick({ kind: "at", local })}>
            {local.slice(11)}
          </button>
        ))}
        <button type="button" className="chip col-span-2 px-0" aria-pressed={picker} disabled={disabled} onClick={() => {
            setCustom(true);
            // Keep a time already chosen (its day too, on a past day); else half an hour ago.
            if (value.kind !== "at") onChange({ kind: "at", local: toLocalInput(new Date(Date.now() - 30 * 60_000).toISOString(), timezone) });
          }}>
          At a time…
        </button>
      </div>
      {picker && value.kind === "at" && <input className="input" type="datetime-local" value={value.local} max={toLocalInput(new Date().toISOString(), timezone)} onChange={(e) => e.target.value && onChange({ kind: "at", local: e.target.value })} aria-label="Time it happened" />}
    </div>
  );
}
export { AGO_PRESETS };
