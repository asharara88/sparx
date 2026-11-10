"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AttendanceOpen } from "@/lib/types";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtTime } from "@/lib/time";
import { Icon } from "@/components/Icon";

/**
 * One big button: "I'm here" when you arrive, "Leaving" when you go. Shows when you came in.
 * With memberId an admin toggles it for someone else (a small button on the home screen).
 */
export function AttendanceButton({ open, memberId, name, timezone, small = false }: { open: AttendanceOpen | null; memberId?: string; name?: string; timezone: string; small?: boolean }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  // The button flips the state on the server, and its label comes from the page: it stays
  // off until the refreshed page arrives, or a second tap would check straight back out.
  const [refreshing, startRefresh] = useTransition();
  const busy = saving || refreshing;
  const [msg, setMsg] = useState<string | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  async function toggle() {
    if (busy) return;
    setSaving(true);
    setMsg(null);
    const { data, error } = await supabaseBrowser().rpc("attendance_toggle", { p_member_id: memberId ?? null });
    const res = data as { ok: boolean; message?: string } | null;
    if (error || !res?.ok) {
      setSaving(false);
      return setMsg(res?.message ?? error?.message ?? "Could not save.");
    }
    startRefresh(() => {
      setSaving(false);
      router.refresh();
    });
  }
  if (small) {
    return (
      <button type="button" className="btn btn-secondary" style={{ minHeight: 40 }} onClick={toggle} disabled={busy}>
        {open ? `${name ?? "Mark"} left` : `${name ?? "Mark"} is here`}
      </button>
    );
  }
  return (
    <section className={`notice ${open ? "notice-ok" : ""} flex items-center justify-between gap-3`}>
      <div>
        <p className="font-semibold">{open ? `Here since ${fmtTime(open.in_at, timezone)}` : "Not checked in"}</p>
        {msg && <p className="text-sm text-[var(--danger)]">{msg}</p>}
      </div>
      <button type="button" className={`btn ${open ? "" : "btn-primary"} shrink-0`} onClick={toggle} disabled={busy}>
        <Icon name={open ? "logout" : "check"} size={18} /> {open ? "Leaving" : "I'm here"}
      </button>
    </section>
  );
}
