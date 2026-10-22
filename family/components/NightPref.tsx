"use client";
import { useEffect, useState } from "react";
import { autoNightEnabled, setAutoNightEnabled } from "@/lib/theme";

/** Me screen: the automatic dark screen at night, per phone. */
export function NightPref({ from, to }: { from: string; to: string }) {
  const [on, setOn] = useState(true);
  useEffect(() => setOn(autoNightEnabled()), []);
  return (
    <label className="flex items-center justify-between gap-3">
      <span>
        <span className="block font-semibold">Dark screen at night</span>
        <span className="muted block text-sm">
          From {from} to {to} the app goes very dark on this phone, so a night
          feed is not a bright light in the room.
        </span>
      </span>
      <input
        type="checkbox"
        className="h-7 w-7"
        style={{ minHeight: 0 }}
        checked={on}
        onChange={(e) => {
          setOn(e.target.checked);
          setAutoNightEnabled(e.target.checked);
        }}
      />
    </label>
  );
}
