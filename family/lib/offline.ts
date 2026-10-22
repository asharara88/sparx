"use client";
/**
 * Offline queue for log entries. 3am logging must never be lost: if the
 * network is down we keep the tap on the phone and send it when we are back.
 *
 * Two kinds of operation wait in the queue: a new entry ("log"), and the end of
 * a timer ("end"). Each new entry carries a client_id so re-sending never creates
 * a duplicate, and an end can name the start by that client_id when the start
 * has no server id yet. The queue is shared per phone but every operation is
 * stamped with the signed-in user who made it, so a later sign-in by someone
 * else on the same phone does not send it in their name, and with the home it
 * was made in, so it is replayed into that home whatever the phone shows later.
 */
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

/** The request header naming the home (HOME_HEADER in lib/home-cookie.ts; repeated here so the node test runner can load this file). */
const HOME_HEADER = "x-home";
const KEY = "family.queue.v1";
const FAILED_KEY = "family.queue.failed.v1";
const EVENT = "family-queue";

export interface QueuedEntry {
  op?: "log";
  client_id: string;
  subject_id: string;
  type_id: string;
  occurred_at: string;
  ended_at: string | null;
  payload: Record<string, unknown>;
  note: string | null;
  queued_at: string;
  /** auth user id of whoever tapped; null for entries queued before this field existed */
  owner?: string | null;
  /** the home the screen showed when it was tapped; null for entries queued before this field existed */
  home?: string | null;
}

export interface QueuedEnd {
  op: "end";
  /** key of this operation in the queue */
  client_id: string;
  /** the entry's server id, when it has one */
  entry_id: string | null;
  /** else the client_id the entry was started with */
  start_client_id: string | null;
  ended_at: string;
  queued_at: string;
  owner?: string | null;
  home?: string | null;
}

export type QueuedOp = QueuedEntry | QueuedEnd;

/** The home the page shows, set by the app layout (BindHome); stamped on every new operation. */
let queueHome: string | null = null;
export function setQueueHome(id: string | null) {
  queueHome = id;
}

export interface FailedOp {
  op: QueuedOp;
  message: string;
  failed_at: string;
}

export type SendResult =
  | { status: "saved"; id: string; open?: boolean }
  | { status: "queued" }
  | { status: "error"; message: string };

/** Prefix of the id a queued start is given on screen, before the server has named it. */
export const QUEUED_ID_PREFIX = "queued:";

function readJson<T>(key: string): T[] {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(key);
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

/** False when the phone could not keep it (storage missing, full, or blocked): never say "saved" then. */
function writeJson(key: string, v: unknown[]): boolean {
  let kept = false;
  try {
    localStorage.setItem(key, JSON.stringify(v));
    kept = localStorage.getItem(key) === JSON.stringify(v);
  } catch {
    kept = false;
  }
  try {
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* not in a browser */
  }
  return kept;
}

const NOT_KEPT = "No signal, and this phone could not keep the entry. Try again when you are back online.";

/** Every waiting operation, or only one user's (`owner`), oldest first. */
export function readQueue(owner?: string | null): QueuedOp[] {
  const q = readJson<QueuedOp>(KEY);
  return owner === undefined ? q : q.filter((x) => (x.owner ?? null) === null || x.owner === owner);
}

function writeQueue(q: QueuedOp[]): boolean {
  return writeJson(KEY, q);
}

/** Keep an operation on this phone; false when it could not be kept. */
export function enqueue(e: QueuedOp): boolean {
  return writeQueue([...readQueue().filter((x) => x.client_id !== e.client_id), e]);
}

export function readFailed(owner?: string | null): FailedOp[] {
  const f = readJson<FailedOp>(FAILED_KEY);
  return owner === undefined ? f : f.filter((x) => (x.op.owner ?? null) === null || x.op.owner === owner);
}

export function dismissFailed(owner?: string | null) {
  writeJson(FAILED_KEY, owner === undefined ? [] : readFailed().filter((x) => !((x.op.owner ?? null) === null || x.op.owner === owner)));
}

/** Subscribe to queue changes made in this tab or another; returns the unsubscribe. */
export function onQueueChange(fn: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, fn);
  window.addEventListener("storage", fn);
  return () => {
    window.removeEventListener(EVENT, fn);
    window.removeEventListener("storage", fn);
  };
}

export function newClientId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // Not a secure context (plain http on the LAN): a v4-shaped id from Math.random, still a valid uuid.
  const hex = () => Math.floor(Math.random() * 16).toString(16);
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) =>
    c === "x" ? hex() : (8 + Math.floor(Math.random() * 4)).toString(16),
  );
}

/**
 * Is this error the network's fault rather than the request's? Those are kept for
 * later; a refusal (permission, bad type, bad time) is shown and not retried.
 * No Postgres/PostgREST code means the request never reached the database (a
 * fetch failure, a gateway page); PGRST301/303 are an expired or missing token,
 * which a later retry with a fresh session fixes; classes 08, 53 and 57 are
 * connection, resource and operator-intervention errors on the server.
 */
export function isTransient(error: Pick<PostgrestError, "code" | "message"> | { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const msg = error.message ?? "";
  if (/fetch|network|Load failed|timed? ?out|gateway|unavailable|<html/i.test(msg)) return true;
  if (!code) return true;
  if (code === "PGRST301" || code === "PGRST303") return true;
  if (/^(08|53|57)/.test(code)) return true;
  return false;
}

/** The signed-in user's waiting operations (plus any queued before owners existed). */
export async function readQueueFor(supabase: SupabaseClient): Promise<QueuedOp[]> {
  return readQueue(await currentOwner(supabase));
}

async function currentOwner(supabase: SupabaseClient): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.user.id ?? null;
  } catch {
    return null;
  }
}

/**
 * The request names the home the operation was made in (lib/home-cookie.ts), so a
 * replay lands there whatever the phone shows now. An operation from before homes
 * were stamped goes without, as the home on screen.
 */
function inHome<T extends { setHeader(name: string, value: string): T }>(req: T, home: string | null | undefined): T {
  return home ? req.setHeader(HOME_HEADER, home) : req;
}

function rpcLog(supabase: SupabaseClient, e: QueuedEntry) {
  return inHome(
    supabase.rpc("care_entry_log", {
      p_subject_id: e.subject_id,
      p_type_id: e.type_id,
      p_occurred_at: e.occurred_at,
      p_ended_at: e.ended_at,
      p_payload: e.payload,
      p_note: e.note,
      p_client_id: e.client_id,
    }),
    e.home,
  );
}

function rpcEnd(supabase: SupabaseClient, e: QueuedEnd) {
  return inHome(
    e.entry_id
      ? supabase.rpc("care_entry_end", { p_id: e.entry_id, p_ended_at: e.ended_at })
      : supabase.rpc("care_entry_end_client", { p_client_id: e.start_client_id, p_ended_at: e.ended_at }),
    e.home,
  );
}

type RpcRes = { ok: boolean; id?: string; open?: boolean; error?: string; message?: string } | null;

/** Try to send a log entry now; when the network is the problem keep it for later. */
export async function sendOrQueue(supabase: SupabaseClient, e: Omit<QueuedEntry, "queued_at" | "owner" | "op">): Promise<SendResult> {
  const owner = await currentOwner(supabase);
  const queued: QueuedEntry = { ...e, op: "log", queued_at: new Date().toISOString(), owner, home: queueHome };
  if (typeof navigator !== "undefined" && !navigator.onLine) return keep(queued);
  const { data, error } = await rpcLog(supabase, queued);
  if (error) {
    if (isTransient(error)) return keep(queued);
    return { status: "error", message: error.message };
  }
  const res = data as RpcRes;
  if (!res?.ok) return { status: "error", message: res?.message ?? "Could not save." };
  return { status: "saved", id: res.id!, open: res.open === true };
}

/**
 * End a timer now, or keep the end for later. `entryId` is the server id, or a
 * queued id (`queued:<client_id>`) for a start that is still on this phone: then
 * the start itself is given its end time and nothing extra is sent.
 */
export async function endOrQueue(supabase: SupabaseClient, entryId: string, endedAt: string): Promise<SendResult> {
  const owner = await currentOwner(supabase);
  if (entryId.startsWith(QUEUED_ID_PREFIX)) {
    const startId = entryId.slice(QUEUED_ID_PREFIX.length);
    // Only this user's queued starts: another user's timer on a shared phone is not ours to end.
    const start = readQueue(owner).find((x) => (x.op ?? "log") === "log" && x.client_id === startId) as QueuedEntry | undefined;
    if (start) {
      if (Date.parse(endedAt) < Date.parse(start.occurred_at)) return { status: "error", message: "The end time is before the start time." };
      if (!writeQueue(readQueue().map((x) => (x.client_id === startId ? { ...start, ended_at: endedAt } : x)))) return { status: "error", message: NOT_KEPT };
      return { status: "queued" };
    }
    // The start went out between the screen loading and this tap: end it by its client_id.
    return endOp(supabase, { op: "end", client_id: newClientId(), entry_id: null, start_client_id: startId, ended_at: endedAt, queued_at: new Date().toISOString(), owner, home: queueHome });
  }
  return endOp(supabase, { op: "end", client_id: newClientId(), entry_id: entryId, start_client_id: null, ended_at: endedAt, queued_at: new Date().toISOString(), owner, home: queueHome });
}

function keep(e: QueuedOp): SendResult {
  return enqueue(e) ? { status: "queued" } : { status: "error", message: NOT_KEPT };
}

async function endOp(supabase: SupabaseClient, e: QueuedEnd): Promise<SendResult> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return keep(e);
  const { data, error } = await rpcEnd(supabase, e);
  if (error) {
    if (isTransient(error)) return keep(e);
    return { status: "error", message: error.message };
  }
  const res = data as RpcRes;
  if (!res?.ok) return { status: "error", message: res?.message ?? "Could not save." };
  return { status: "saved", id: res.id! };
}

/**
 * Send everything the signed-in user has waiting, oldest first, so a start always
 * goes before its end. Stops at the first network failure. An operation the server
 * refuses is moved to the failed list (shown on screen, never silently dropped),
 * except an end whose start has not arrived yet, which waits for the next round.
 *
 * The queue is read again before every send: a tap can change it while a send is
 * in flight. In particular, "woke up" during the upload of a queued "fell asleep"
 * writes the end onto that queued start; once the start is on the server, the end
 * it picked up meanwhile becomes its own end operation and goes next.
 *
 * Each operation goes to the home it was made in (its request names it), so a phone
 * that has since switched homes still writes the entry where it belongs.
 */
export async function flushQueue(supabase: SupabaseClient): Promise<{ sent: number; failed: number }> {
  const owner = await currentOwner(supabase);
  if (!owner) return { sent: 0, failed: 0 };
  let sent = 0;
  let failed = 0;
  const seen = new Set<string>();
  for (;;) {
    const e = readQueue(owner).find((x) => !seen.has(x.client_id));
    if (!e) break;
    seen.add(e.client_id);
    const isLog = (e.op ?? "log") === "log";
    const { data, error } = isLog ? await rpcLog(supabase, e as QueuedEntry) : await rpcEnd(supabase, e as QueuedEnd);
    if (error) {
      if (isTransient(error)) break;
      fail(e, error.message);
      failed += 1;
      continue;
    }
    const res = data as RpcRes;
    if (res?.ok) {
      const now = readQueue().find((x) => x.client_id === e.client_id);
      const endedMeanwhile = isLog && now && (now.op ?? "log") === "log" && (now as QueuedEntry).ended_at && (now as QueuedEntry).ended_at !== (e as QueuedEntry).ended_at;
      const rest = readQueue().filter((x) => x.client_id !== e.client_id);
      if (endedMeanwhile && res.id) {
        const end: QueuedEnd = { op: "end", client_id: newClientId(), entry_id: res.id, start_client_id: null, ended_at: (now as QueuedEntry).ended_at!, queued_at: new Date().toISOString(), owner, home: e.home ?? null };
        writeQueue([...rest, end]);
      } else {
        writeQueue(rest);
      }
      sent += 1;
    } else if (e.op === "end" && e.start_client_id && res?.error === "not_found") {
      continue; // the start is still ahead of us or on another phone; try again next time
    } else {
      fail(e, res?.message ?? "Could not save.");
      failed += 1;
    }
  }
  return { sent, failed };
}

function fail(e: QueuedOp, message: string) {
  writeQueue(readQueue().filter((x) => x.client_id !== e.client_id));
  writeJson(FAILED_KEY, [...readFailed(), { op: e, message, failed_at: new Date().toISOString() }]);
}

export interface LocalOngoing {
  id: string;
  type_id: string;
  occurred_at: string;
  payload: Record<string, unknown>;
  by: string | null;
}

/** The part of an entry type that decides whether an open entry is a timer. */
export interface TimerType {
  id: string;
  has_end: boolean;
  settings?: { end_if?: Record<string, string> };
}

/** Same rule as the database: the type times entries, and the payload matches its end_if. */
export function isTimer(types: TimerType[] | undefined, typeId: string, payload: Record<string, unknown>): boolean {
  if (!types) return true;
  const t = types.find((x) => x.id === typeId);
  if (!t || !t.has_end) return false;
  const rule = t.settings?.end_if;
  return !rule || Object.entries(rule).every(([k, v]) => String(payload[k] ?? "") === v);
}

/**
 * What the screen should treat as running for a subject: the server's open timers,
 * minus any that have an end waiting on this phone, plus starts waiting on this
 * phone that have no end yet (ids `queued:<client_id>`). With `types`, only starts
 * the type actually times count (a bottle with no end time is not "feeding").
 */
export function mergeOngoing<T extends LocalOngoing>(server: T[], subjectId: string, queue: QueuedOp[] = readQueue(), byName: string | null = null, types?: TimerType[]): (T | LocalOngoing)[] {
  const endedIds = new Set(queue.filter((x): x is QueuedEnd => x.op === "end" && !!x.entry_id).map((x) => x.entry_id!));
  const endedStarts = new Set(queue.filter((x): x is QueuedEnd => x.op === "end" && !!x.start_client_id).map((x) => x.start_client_id!));
  const kept = server.filter((e) => !endedIds.has(e.id));
  const local: LocalOngoing[] = queue
    .filter((x): x is QueuedEntry => (x.op ?? "log") === "log")
    .filter((x) => x.subject_id === subjectId && x.ended_at === null && !endedStarts.has(x.client_id) && isTimer(types, x.type_id, x.payload))
    .map((x) => ({ id: QUEUED_ID_PREFIX + x.client_id, type_id: x.type_id, occurred_at: x.occurred_at, payload: x.payload, by: byName }));
  return [...kept, ...local].sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
}
