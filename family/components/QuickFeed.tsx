"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { EntryType, OngoingEntry } from "@/lib/types";
import { supabaseBrowser } from "@/lib/supabase/client";
import {
  endOrQueue,
  mergeOngoing,
  newClientId,
  onQueueChange,
  readQueueFor,
  sendOrQueue,
  type QueuedOp,
} from "@/lib/offline";
import { fmtDuration, fmtTime, minutesBetween } from "@/lib/time";
import { Boobs } from "@/components/Boobs";

type Side = "Left" | "Right";
const sideOf = (p: Record<string, unknown>): Side | null =>
  p.method === "Breast" && (p.side === "Left" || p.side === "Right")
    ? p.side
    : null;

/**
 * The home-screen shortcut for a night feed: the two boobs and nothing else. The left one
 * starts the left side, the other one switches, the lit one finishes. Every tap goes through
 * the offline queue, so a 3 a.m. tap with no signal is kept on the phone and sent later.
 */
export function QuickFeed({
  subjectId,
  typeId,
  types,
  ongoing: serverOngoing,
  lastSide,
  counts,
  timezone,
}: {
  subjectId: string;
  typeId: string;
  types: EntryType[];
  ongoing: OngoingEntry[];
  lastSide: Side | null;
  counts: { Left: number; Right: number };
  timezone: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);
  // A feed started with no signal is still on this phone; it counts as running.
  const [queue, setQueue] = useState<QueuedOp[]>([]);
  useEffect(() => {
    const sb = supabaseBrowser();
    const load = () => void readQueueFor(sb).then(setQueue);
    load();
    return onQueueChange(load);
  }, []);
  const feeding =
    mergeOngoing(serverOngoing, subjectId, queue, null, types).find(
      (e) => e.type_id === typeId,
    ) ?? null;
  const active = feeding ? sideOf(feeding.payload) : null;
  const minutes = feeding
    ? Math.max(0, minutesBetween(feeding.occurred_at, new Date().toISOString()))
    : 0;
  const suggested: Side | null =
    lastSide === "Left" ? "Right" : lastSide === "Right" ? "Left" : null;

  let queued = false;
  async function startSide(side: Side) {
    const r = await sendOrQueue(supabaseBrowser(), {
      client_id: newClientId(),
      subject_id: subjectId,
      type_id: typeId,
      occurred_at: new Date().toISOString(),
      ended_at: null,
      payload: { method: "Breast", side },
      note: null,
    });
    if (r.status === "error") throw new Error(r.message);
    if (r.status === "queued") queued = true;
  }
  async function endFeed(entry: OngoingEntry) {
    const r = await endOrQueue(
      supabaseBrowser(),
      entry.id,
      new Date().toISOString(),
    );
    if (r.status === "error") throw new Error(r.message);
    if (r.status === "queued") queued = true;
  }
  async function act(label: string, fn: () => Promise<void>) {
    setBusy(true);
    setMsg(null);
    queued = false;
    try {
      await fn();
      setMsg(
        queued
          ? `${label} Saved on this phone; it will send when back online.`
          : label,
      );
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }
  function tap(side: Side) {
    if (feeding && active === side)
      return void act("Feed saved.", () => endFeed(feeding));
    if (feeding)
      return void act(`Switched to ${side.toLowerCase()} boob.`, async () => {
        await endFeed(feeding);
        await startSide(side);
      });
    void act(`${side} boob started.`, () => startSide(side));
  }

  return (
    <div className="flex flex-col gap-3">
      <Boobs
        active={active}
        elapsed={feeding ? fmtDuration(minutes) : null}
        suggested={feeding ? null : suggested}
        counts={counts}
        disabled={busy}
        onTap={tap}
      />
      {feeding && (
        <button
          type="button"
          className="btn btn-primary"
          style={{ minHeight: 72, fontSize: "1.25rem" }}
          disabled={busy}
          onClick={() => void act("Feed saved.", () => endFeed(feeding))}
        >
          Done feeding · since {fmtTime(feeding.occurred_at, timezone)}
        </button>
      )}
      {feeding && minutes >= 30 && (
        <p
          className="notice notice-warn text-center font-semibold"
          role="status"
        >
          Still feeding? Over 30 min on one side. The timer may have been left
          on: tap the lit boob to stop it.
        </p>
      )}
      {msg && (
        <p role="status" className="notice notice-ok text-center font-semibold">
          {msg}
        </p>
      )}
    </div>
  );
}
