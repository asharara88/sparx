"use client";
import { useEffect } from "react";
import { bindHome } from "@/lib/supabase/client";
import { setQueueHome } from "@/lib/offline";

export const HOME_NAME_KEY = "elnunu.home";

/**
 * Binds this page to the home it shows: every request from here names it (the
 * cookie and the x-home header, lib/home-cookie.ts), the offline queue stamps it on
 * what it keeps, and the sign-in screen can say whose home this device is.
 */
export function BindHome({ id, name }: { id: string; name: string }) {
  // Bound during render, not in an effect: children's effects (the queue flusher, the
  // first fetches) run before this component's would. On the server there is nothing to bind.
  if (typeof window !== "undefined") {
    bindHome(id);
    setQueueHome(id);
  }
  useEffect(() => {
    bindHome(id);
    setQueueHome(id);
    try {
      localStorage.setItem(HOME_NAME_KEY, name);
    } catch {
      // private mode or storage off: the sign-in screen simply stays generic
    }
  }, [id, name]);
  return null;
}
