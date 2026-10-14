"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { OngoingEntry } from "@/lib/types";
import { supabaseBrowser } from "@/lib/supabase/client";
import { newClientId } from "@/lib/offline";
import { fmtTime } from "@/lib/time";
import { Icon } from "@/components/Icon";

/** The home-screen shortcut: one big button that starts or ends her sleep. */
export function QuickSleep({ subjectId, typeId, asleep, timezone }: { subjectId: string; typeId: string; asleep: OngoingEntry | null; timezone: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function go() {
    setBusy(true);
    setMsg(null);
    const sb = supabaseBrowser();
    const { data, error } = asleep
      ? await sb.rpc("care_entry_end", { p_id: asleep.id, p_ended_at: new Date().toISOString() })
      : await sb.rpc("care_entry_log", { p_subject_id: subjectId, p_type_id: typeId, p_occurred_at: new Date().toISOString(), p_ended_at: null, p_payload: {}, p_note: null, p_client_id: newClientId() });
    const res = data as { ok: boolean; message?: string } | null;
    setBusy(false);
    if (error || !res?.ok) return setMsg(res?.message ?? error?.message ?? "Could not save.");
    setMsg(asleep ? "Woke up, saved." : "Sleep started.");
    router.refresh();
  }
  return (
    <div className="flex flex-col gap-3">
      <button type="button" className={`btn ${asleep ? "" : "btn-primary"} flex-col gap-2`} style={{ minHeight: 160, fontSize: "1.5rem" }} disabled={busy} onClick={() => void go()}>
        <Icon name={asleep ? "sun" : "zzz"} size={40} />
        {asleep ? `Woke up (asleep since ${fmtTime(asleep.occurred_at, timezone)})` : "Fell asleep now"}
      </button>
      {msg && (
        <p role="status" className="notice notice-ok text-center font-semibold">
          {msg}
        </p>
      )}
    </div>
  );
}
