"use client";
import { useEffect } from "react";

export const HOME_NAME_KEY = "elnunu.home";

/** Keeps the home's name on this device, so the sign-in screen can say whose it is. */
export function RememberHome({ name }: { name: string }) {
  useEffect(() => {
    try {
      localStorage.setItem(HOME_NAME_KEY, name);
    } catch {
      // private mode or storage off: the sign-in screen simply stays generic
    }
  }, [name]);
  return null;
}
