"use client";
import { useState } from "react";
import { AGO_PRESETS, agoLabel, NOW, type When } from "@/lib/when";
import { toLocalInput } from "@/lib/time";

/**
 * "When?" for logging after the fact: Now, a few minutes ago, or a time.
 * Collapsed to one line until tapped, so the one-tap screen stays one tap.
 */
export function WhenChips({ value, onChange, timezone, presets = [15, 30, 60, 120], label = "When", disabled = false, alwaysOpen = false }: { value: When; onChange: (w: When) => void; timezone: string; presets?: readonly number[]; label?: string; disabled?: boolean; alwaysOpen?: boolean }) {
  const [open, setOpen] = useState(alwaysOpen);
  const summary = value.kind === "now" ? "now" : value.kind === "ago" ? agoLabel(value.min) : `at ${value.local.slice(11)}${value.local.slice(0, 10) !== toLocalInput(new Date().toISOString(), timezone).slice(0, 10) ? ` on ${value.local.slice(5, 10)}` : ""}`;
  if (!open) {
    return (
      <button type="button" className={`chip self-start text-sm ${value.kind !== "now" ? "" : "muted"}`} aria-pressed={value.kind !== "now"} disabled={disabled} onClick={() => setOpen(true)}>
        {label}: {summary} {value.kind === "now" ? "· earlier?" : "· change"}
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-2" role="group" aria-label={label}>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="chip" aria-pressed={value.kind === "now"} disabled={disabled} onClick={() => onChange(NOW)}>
          Now
        </button>
        {presets.map((m) => (
          <button key={m} type="button" className="chip" aria-pressed={value.kind === "ago" && value.min === m} disabled={disabled} onClick={() => onChange({ kind: "ago", min: m })}>
            {agoLabel(m)}
          </button>
        ))}
        <button type="button" className="chip" aria-pressed={value.kind === "at"} disabled={disabled} onClick={() => onChange({ kind: "at", local: toLocalInput(new Date(Date.now() - 30 * 60_000).toISOString(), timezone) })}>
          At a time…
        </button>
        {!alwaysOpen && (
          <button type="button" className="chip muted" disabled={disabled} onClick={() => setOpen(false)}>
            Done
          </button>
        )}
      </div>
      {value.kind === "at" && <input className="input" type="datetime-local" value={value.local} max={toLocalInput(new Date().toISOString(), timezone)} onChange={(e) => e.target.value && onChange({ kind: "at", local: e.target.value })} aria-label="Time it happened" />}
    </div>
  );
}
export { AGO_PRESETS };
