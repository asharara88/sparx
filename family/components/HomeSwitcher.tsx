"use client";
import { useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { HomeListing } from "@/lib/types";
import { Icon } from "./Icon";

/**
 * The homes this account is in, the current one first. The choice is kept on the
 * account (home_switch), so every device follows it; the page then loads whole,
 * so nothing cached for the old home survives the switch.
 */
export function HomeSwitcher({ homes }: { homes: HomeListing[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function go(h: HomeListing) {
    setBusy(h.household_id);
    setMsg(null);
    const { data, error } = await supabaseBrowser().rpc("home_switch", { p_household_id: h.household_id });
    const res = data as { ok: boolean; message?: string } | null;
    if (error || !res?.ok) {
      setBusy(null);
      return setMsg(res?.message ?? error?.message ?? "Could not switch.");
    }
    window.location.assign("/");
  }

  return (
    <div className="card flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Your homes</h2>
      {homes.length > 1 ? (
        <ul className="flex flex-col gap-2">
          {homes.map((h) => (
            <li key={h.household_id} className="flex items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="block font-semibold">{h.name}</span>
                <span className="muted block truncate text-sm">
                  {h.display_name} · {h.role_label}
                </span>
              </span>
              {h.current ? (
                <span className="muted shrink-0 text-sm">You are here</span>
              ) : (
                <button type="button" className="btn shrink-0" onClick={() => go(h)} disabled={busy !== null}>
                  {busy === h.household_id ? "Switching…" : "Switch"}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted text-sm">Just this one. When someone lists your e-mail on their Members screen, their home appears here too.</p>
      )}
      {msg && (
        <p className="notice notice-danger" role="alert">
          {msg}
        </p>
      )}
      <Link href="/me/homes/new" className="btn">
        <Icon name="plus" size={18} /> Create another home
      </Link>
    </div>
  );
}
