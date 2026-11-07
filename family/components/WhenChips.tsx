"use client";
import { useState } from "react";
import { AGO_PRESETS, agoLabel, clockMarks, MARK_COUNT, NOW, type When } from "@/lib/when";
import { addDays, toLocalInput } from "@/lib/time";
import { TimeBox } from "./TimeBox";

/**
 * "When?" for logging after the fact: now, or a clock time from the last two hours on a
 * ten-minute grid (13:50, 13:40, …), or any time typed in (TimeBox: "2130", "9:30pm").
 * Clock times, not "80 min ago", so it matches the clock on the wall. Collapsed to one line
 * until tapped, so the one-tap screen stays one tap; picking a chip folds it back.
 */
export function WhenChips({ value, onChange, timezone, marks = MARK_COUNT, label = "When", disabled = false, alwaysOpen = false, defaultOpen = false }: { value: When; onChange: (w: When) => void; timezone: string; marks?: number; label?: string; disabled?: boolean; alwaysOpen?: boolean; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(alwaysOpen || defaultOpen);
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
    if (!alwaysOpen) setOpen(false);
  };
  const times = clockMarks(Date.now(), (iso) => toLocalInput(iso, timezone), marks);
  const today = toLocalInput(new Date().toISOString(), timezone).slice(0, 10);
  // A time on a past day (the day being filled in) is typed on that day; otherwise the most recent.
  const held = value.kind === "at" ? value.local.slice(0, 10) : null;
  const onDay = held && held < addDays(today, -1) ? held : null;
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
      </div>
      <TimeBox
        key={onDay ?? "recent"}
        label="or type it"
        value={value.kind === "at" && !times.includes(value.local) ? value.local : null}
        day={onDay}
        yesterday={!onDay}
        timezone={timezone}
        disabled={disabled}
        onChange={(local) => local && onChange({ kind: "at", local })}
      />
    </div>
  );
}
export { AGO_PRESETS };
