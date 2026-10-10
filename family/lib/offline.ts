"use client";
/**
 * Offline queue for log entries. 3am logging must never be lost: if the
 * network is down we keep the entry on the phone and send it when we are back.
 * Each entry carries a client_id so re-sending never creates duplicates.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const KEY = "family.queue.v1";

export interface QueuedEntry {
  client_id: string;
  subject_id: string;
  type_id: string;
  occurred_at: string;
  ended_at: string | null;
  payload: Record<string, unknown>;
  note: string | null;
  queued_at: string;
}

export function readQueue(): QueuedEntry[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as QueuedEntry[];
  } catch {
    return [];
  }
}

function writeQueue(q: QueuedEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(q));
  } catch {
    /* storage unavailable: nothing we can do */
  }
}

export function enqueue(e: QueuedEntry) {
  writeQueue([...readQueue().filter((x) => x.client_id !== e.client_id), e]);
}

export function newClientId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`.padEnd(36, "0");
}

/** Try to send a log entry now; on a network failure keep it for later. Returns how it went. */
export async function sendOrQueue(
  supabase: SupabaseClient,
  e: Omit<QueuedEntry, "queued_at">,
): Promise<{ status: "saved"; id: string } | { status: "queued" } | { status: "error"; message: string }> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    enqueue({ ...e, queued_at: new Date().toISOString() });
    return { status: "queued" };
  }
  const { data, error } = await supabase.rpc("care_entry_log", {
    p_subject_id: e.subject_id,
    p_type_id: e.type_id,
    p_occurred_at: e.occurred_at,
    p_ended_at: e.ended_at,
    p_payload: e.payload,
    p_note: e.note,
    p_client_id: e.client_id,
  });
  if (error) {
    // A fetch failure means no network; anything else is a real error.
    if (/fetch|network|Failed to fetch|Load failed/i.test(error.message)) {
      enqueue({ ...e, queued_at: new Date().toISOString() });
      return { status: "queued" };
    }
    return { status: "error", message: error.message };
  }
  const res = data as { ok: boolean; id?: string; message?: string };
  if (!res.ok) return { status: "error", message: res.message ?? "Could not save." };
  return { status: "saved", id: res.id! };
}

/** Send everything in the queue. Stops at the first network failure. */
export async function flushQueue(supabase: SupabaseClient): Promise<number> {
  let sent = 0;
  for (const e of readQueue()) {
    const { data, error } = await supabase.rpc("care_entry_log", {
      p_subject_id: e.subject_id,
      p_type_id: e.type_id,
      p_occurred_at: e.occurred_at,
      p_ended_at: e.ended_at,
      p_payload: e.payload,
      p_note: e.note,
      p_client_id: e.client_id,
    });
    if (error) break;
    const res = data as { ok: boolean };
    // ok → remove; a permission or type error will never succeed → remove too, so it does not block the queue
    writeQueue(readQueue().filter((x) => x.client_id !== e.client_id));
    if (res.ok) sent += 1;
  }
  return sent;
}
