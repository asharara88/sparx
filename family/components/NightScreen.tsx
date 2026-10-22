"use client";
import { useEffect } from "react";
import { hhmmIn, inNight } from "@/lib/night";
import {
  NIGHT_PREF_EVENT,
  NIGHT_PREF_KEY,
  autoNightEnabled,
  setAutoNight,
} from "@/lib/theme";

/**
 * During the child's night the whole app is very dark, so a 3 a.m. feed is not logged
 * under a bright screen. The inline script sets the theme before the first paint, so
 * the page never flashes light; the effect keeps it right as the night starts and ends.
 */
export function NightScreen({
  from,
  to,
  timezone,
}: {
  from: string;
  to: string;
  timezone: string;
}) {
  useEffect(() => {
    const check = () =>
      setAutoNight(
        autoNightEnabled() && inNight(hhmmIn(Date.now(), timezone), from, to),
      );
    check();
    const t = setInterval(check, 30_000);
    document.addEventListener("visibilitychange", check);
    window.addEventListener(NIGHT_PREF_EVENT, check);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener(NIGHT_PREF_EVENT, check);
      setAutoNight(false);
    };
  }, [from, to, timezone]);
  const boot = `(function(){try{if(localStorage.getItem(${JSON.stringify(NIGHT_PREF_KEY)})==="0")return;var f=${JSON.stringify(from)},t=${JSON.stringify(to)},h=new Intl.DateTimeFormat("en-GB",{hour:"2-digit",minute:"2-digit",hourCycle:"h23",timeZone:${JSON.stringify(timezone)}}).format(new Date());if(f===t)return;if(f>t?(h>=f||h<t):(h>=f&&h<t))document.documentElement.setAttribute("data-theme","night")}catch(e){}})()`;
  return <script dangerouslySetInnerHTML={{ __html: boot }} />;
}
