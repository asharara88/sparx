"use client";
import { useState } from "react";
import { dayWord, resolveTyped } from "@/lib/typed-time";
import { toLocalInput } from "@/lib/time";

/**
 * Type the time (Mido, 7 November): "2130", "21:30", "930", "9pm". The number keypad opens;
 * what was understood is read back under it ("= yesterday 21:30"). Without `day` it is the
 * most recent such time; with `day`, that day. "Yesterday" moves it a day back. A time
 * after `max` or before `min` says so and is not passed on.
 */
export function TimeBox({
  value,
  onChange,
  timezone,
  label,
  day = null,
  min = null,
  max,
  minWord = "the start",
  rollAfter = null,
  yesterday: showYesterday = true,
  autoFocus = false,
  disabled = false,
}: {
  /** Local "YYYY-MM-DDTHH:MM", or null for none yet. */
  value: string | null;
  /** The resolved local time, or null while what is typed is not a usable time. */
  onChange: (local: string | null) => void;
  timezone: string;
  label: string;
  day?: string | null;
  min?: string | null;
  /** Local; defaults to now. */
  max?: string;
  minWord?: string;
  /** Local: a time typed that falls before this is the next day's (an end after midnight). */
  rollAfter?: string | null;
  yesterday?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const nowLocal = toLocalInput(new Date().toISOString(), timezone);
  const limit = max ?? nowLocal;
  const [text, setText] = useState(value ? value.slice(11, 16) : "");
  // "Yesterday" starts on when the time held is from before the most recent such time (a value
  // carried over from earlier); on a set day it starts off.
  const [back, setBack] = useState(() => !!value && !day && value.slice(0, 16) < (resolveTyped(value.slice(11, 16), nowLocal) ?? ""));
  const resolve = (t: string, y: boolean) => {
    const r = t ? resolveTyped(t, nowLocal, { day, yesterday: y }) : null;
    return r && rollAfter && r < rollAfter.slice(0, 16) ? nextDay(r) : r;
  };
  const resolved = resolve(text, back);
  // A time set from outside (a chip picked beside the box) shows in the box; one typed here is left alone.
  const [held, setHeld] = useState(value);
  if (value !== held) {
    setHeld(value);
    if (value && value.slice(0, 16) !== resolved) setText(value.slice(11, 16));
    // A chip picked beside the box takes over: the typed time and its readback go.
    if (!value && held) setText("");
  }
  const problem = !text ? null : !resolved ? "Not a time. Try 2130 or 9:30" : resolved > limit.slice(0, 16) ? "That is later than now" : min && resolved < min.slice(0, 16) ? `That is before ${minWord}` : null;

  const update = (t: string, y: boolean) => {
    setText(t);
    setBack(y);
    const r = resolve(t, y);
    onChange(r && r <= limit.slice(0, 16) && !(min && r < min.slice(0, 16)) ? r : null);
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-2">
          <span className="shrink-0 whitespace-nowrap font-semibold">{label}</span>
          <input
            className="input min-w-0 flex-1 text-center text-lg tabular-nums"
            inputMode="numeric"
            enterKeyHint="done"
            autoComplete="off"
            placeholder="21:30"
            maxLength={8}
            value={text}
            disabled={disabled}
            autoFocus={autoFocus}
            aria-invalid={!!problem}
            onChange={(e) => update(e.target.value, back)}
          />
        </label>
        {showYesterday && (
          <button type="button" className="chip min-h-[44px]" aria-pressed={back} disabled={disabled} onClick={() => update(text, !back)}>
            Yesterday
          </button>
        )}
      </div>
      {text && (
        <p className={`text-sm ${problem ? "text-[var(--danger)]" : "muted"}`} role={problem ? "alert" : "status"}>
          {problem ?? `= ${dayWord(resolved!, nowLocal)}`}
        </p>
      )}
    </div>
  );
}

function nextDay(local: string): string {
  const d = new Date(`${local.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return `${d.toISOString().slice(0, 10)}${local.slice(10)}`;
}
