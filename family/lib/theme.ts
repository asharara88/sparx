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
/** The choice for this tab when storage is blocked (private mode): it lasts until the tab closes. */
let tabChoice: boolean | null = null;
export function autoNightEnabled(): boolean {
  if (tabChoice !== null) return tabChoice;
  try {
    return localStorage.getItem(NIGHT_PREF_KEY) !== "0";
  } catch {
    return true;
  }
}
export function setAutoNightEnabled(on: boolean) {
  tabChoice = on;
  try {
    localStorage.setItem(NIGHT_PREF_KEY, on ? "1" : "0");
  } catch {
    /* storage blocked: tabChoice carries it */
  }
  window.dispatchEvent(new Event(NIGHT_PREF_EVENT));
}
