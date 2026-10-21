"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { OngoingEntry } from "@/lib/types";
import { supabaseBrowser } from "@/lib/supabase/client";
import { endOrQueue, mergeOngoing, newClientId, onQueueChange, readQueue, sendOrQueue, type QueuedOp } from "@/lib/offline";
import { fmtTime } from "@/lib/time";
import { Icon } from "@/components/Icon";
import { WhenChips } from "@/components/WhenChips";
import { NOW, type When, whenToIso, isEarlier } from "@/lib/when";
import { fromLocalInput } from "@/lib/time";

/** The home-screen shortcut: one big button that starts or ends her sleep. */
export function QuickSleep({ subjectId, typeId, asleep: serverAsleep, timezone }: { subjectId: string; typeId: string; asleep: OngoingEntry | null; timezone: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [when, setWhen] = useState<When>(NOW);
  // A sleep started with no signal is still on this phone; it counts as asleep.
  const [queue, setQueue] = useState<QueuedOp[]>([]);
  useEffect(() => {
    setQueue(readQueue());
    return onQueueChange(() => setQueue(readQueue()));
  }, []);
  const asleep = mergeOngoing(serverAsleep ? [serverAsleep] : [], subjectId, queue).find((e) => e.type_id === typeId) ?? null;

  async function go() {
    setMsg(null);
    const sb = supabaseBrowser();
    const at = whenToIso(when, Date.now(), (l) => fromLocalInput(l, timezone));
    if (asleep && Date.parse(at) < Date.parse(asleep.occurred_at)) {
      return setMsg(`That is before the sleep started at ${fmtTime(asleep.occurred_at, timezone)}. Pick a later time.`);
    }
    setBusy(true);
    const r = asleep
      ? await endOrQueue(sb, asleep.id, at)
      : await sendOrQueue(sb, { client_id: newClientId(), subject_id: subjectId, type_id: typeId, occurred_at: at, ended_at: null, payload: {}, note: null });
    setBusy(false);
    if (r.status === "error") return setMsg(r.message);
    const base = `${asleep ? "Woke up, saved" : "Sleep started"}${isEarlier(when) ? ` as of ${fmtTime(at, timezone)}` : ""}.`;
    setMsg(r.status === "queued" ? `${base} Saved on this phone; it will send when back online.` : base);
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
