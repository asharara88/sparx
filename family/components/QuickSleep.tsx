"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { OngoingEntry } from "@/lib/types";
import { supabaseBrowser } from "@/lib/supabase/client";
import { newClientId } from "@/lib/offline";
import { fmtTime } from "@/lib/time";
import { Icon } from "@/components/Icon";
import { WhenChips } from "@/components/WhenChips";
import { NOW, type When, whenToIso, isEarlier } from "@/lib/when";
import { fromLocalInput } from "@/lib/time";

/** The home-screen shortcut: one big button that starts or ends her sleep. */
export function QuickSleep({ subjectId, typeId, asleep, timezone }: { subjectId: string; typeId: string; asleep: OngoingEntry | null; timezone: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [when, setWhen] = useState<When>(NOW);
  async function go() {
    setBusy(true);
    setMsg(null);
    const sb = supabaseBrowser();
    let at = whenToIso(when, Date.now(), (l) => fromLocalInput(l, timezone));
    if (asleep && Date.parse(at) <= Date.parse(asleep.occurred_at)) at = new Date().toISOString();
    const { data, error } = asleep
      ? await sb.rpc("care_entry_end", { p_id: asleep.id, p_ended_at: at })
      : await sb.rpc("care_entry_log", { p_subject_id: subjectId, p_type_id: typeId, p_occurred_at: at, p_ended_at: null, p_payload: {}, p_note: null, p_client_id: newClientId() });
    const res = data as { ok: boolean; message?: string } | null;
    setBusy(false);
    if (error || !res?.ok) return setMsg(res?.message ?? error?.message ?? "Could not save.");
    setMsg(`${asleep ? "Woke up, saved" : "Sleep started"}${isEarlier(when) ? ` as of ${fmtTime(at, timezone)}` : ""}.`);
    setWhen(NOW);
    router.refresh();
  }
  return (
    <div className="flex flex-col gap-3">
      <button type="button" className={`btn ${asleep ? "" : "btn-primary"} flex-col gap-2`} style={{ minHeight: 160, fontSize: "1.5rem" }} disabled={busy} onClick={() => void go()}>
        <Icon name={asleep ? "sun" : "zzz"} size={40} />
        {asleep ? `Woke up (asleep since ${fmtTime(asleep.occurred_at, timezone)})` : when.kind === "now" ? "Fell asleep now" : "Fell asleep earlier"}
      </button>
      <WhenChips value={when} onChange={setWhen} timezone={timezone} disabled={busy} label={asleep ? "Woke up" : "Fell asleep"} />
      {msg && (
        <p role="status" className="notice notice-ok text-center font-semibold">
          {msg}
        </p>
      )}
    </div>
  );
}
