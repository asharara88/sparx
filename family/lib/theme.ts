"use client";
/**
 * The very dark "night" screen (globals.css, html[data-theme="night"]). Two things ask for it:
 * the clock, through NightScreen during the child's night, and the helper's own moon
 * button. The screen is dark while either asks, and neither can switch the other off.
 */
const asks = { auto: false, manual: false };
function apply() {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  if (asks.auto || asks.manual) el.setAttribute("data-theme", "night");
  else el.removeAttribute("data-theme");
}
export function setAutoNight(on: boolean) {
  asks.auto = on;
  apply();
}
export function setManualNight(on: boolean) {
  asks.manual = on;
  apply();
}

/** Per phone: "0" switches the automatic night screen off (Me screen). */
export const NIGHT_PREF_KEY = "family.night.auto";
export const NIGHT_PREF_EVENT = "family:night-pref";
export function autoNightEnabled(): boolean {
  try {
    return localStorage.getItem(NIGHT_PREF_KEY) !== "0";
  } catch {
    return true;
  }
}
export function setAutoNightEnabled(on: boolean) {
  try {
    localStorage.setItem(NIGHT_PREF_KEY, on ? "1" : "0");
  } catch {
    /* private mode: the choice lasts until the tab closes */
  }
  window.dispatchEvent(new Event(NIGHT_PREF_EVENT));
}
