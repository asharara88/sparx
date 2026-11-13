"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Medicine } from "@/lib/types";
import { can } from "@/lib/types";
import { useMe } from "@/lib/me-context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtDate, fmtTime } from "@/lib/time";
import { Icon } from "@/components/Icon";

/**
 * Each medicine with the hours that must pass between doses. "Given" logs it in
 * the child's log; if the gap has not passed the button asks a second time and says
 * when the next dose is allowed. The app only checks the gap, never the amount.
 */
export function Medicines({ subjectId, items, timezone, compact = false }: { subjectId: string; items: Medicine[]; timezone: string; compact?: boolean }) {
  const me = useMe();
  const router = useRouter();
  const canAdd = can(me, "lana", "add");
  const canEdit = can(me, "lana", "edit");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [early, setEarly] = useState<{ id: string; message: string } | null>(null);
  const [name, setName] = useState("");
  const [dose, setDose] = useState("");
  const [gap, setGap] = useState("6");
  const [adding, setAdding] = useState(false);
  // A dose just given: "Given 14:02 · Undo" on its row for half a minute (a tap is easy to make by mistake).
  const [given, setGiven] = useState<{ medId: string; entryId: string | null; at: string } | null>(null);
  // Tapping a medicine's name shows its one quiet action, Remove, asked twice (no lone ×).
  const [manage, setManage] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const canDelete = can(me, "lana", "delete");
  useEffect(() => {
    if (!given) return;
    const t = setTimeout(() => setGiven(null), 30_000);
    return () => clearTimeout(t);
  }, [given]);
  const now = Date.now();

  async function give(m: Medicine, force = false) {
    setBusy(m.id);
    setMsg(null);
    setEarly(null);
    const { data, error } = await supabaseBrowser().rpc("medicine_give", { p_id: m.id, p_dose: null, p_occurred_at: new Date().toISOString(), p_note: null, p_force: force });
    const res = data as { ok: boolean; error?: string; message?: string; id?: string } | null;
    setBusy(null);
    if (error || !res) return setMsg(error?.message ?? "Could not save.");
    if (!res.ok && res.error === "too_soon") return setEarly({ id: m.id, message: res.message ?? "Too early." });
    if (!res.ok) return setMsg(res.message ?? "Could not save.");
    setGiven({ medId: m.id, entryId: res.id ?? null, at: new Date().toISOString() });
    router.refresh();
  }
  async function undo() {
    if (!given?.entryId) return;
    setBusy(given.medId);
    const { data, error } = await supabaseBrowser().rpc("care_entry_delete", { p_id: given.entryId });
    const res = data as { ok: boolean; message?: string } | null;
    setBusy(null);
    if (error || !res?.ok) return setMsg(res?.message ?? error?.message ?? "Could not undo.");
    setGiven(null);
    router.refresh();
  }
  async function add() {
    const g = Number(gap);
    if (!name.trim() || !(g > 0)) return setMsg("Give it a name and the hours between doses.");
    setBusy("add");
    setMsg(null);
    const { data, error } = await supabaseBrowser().rpc("medicine_save", { p_id: null, p_subject_id: subjectId, p_name: name.trim(), p_min_gap_hours: g, p_dose: dose.trim() || null, p_note: null });
    const res = data as { ok: boolean; message?: string } | null;
    setBusy(null);
    if (error || !res?.ok) return setMsg(res?.message ?? error?.message ?? "Could not save.");
    setName("");
    setDose("");
    setAdding(false);
    router.refresh();
  }
  async function remove(m: Medicine) {
    if (!confirmRemove) return setConfirmRemove(true);
    setConfirmRemove(false);
    setBusy(m.id);
    setMsg(null);
    const { data, error } = await supabaseBrowser().rpc("medicine_remove", { p_id: m.id });
    setBusy(null);
    const res = data as { ok: boolean; message?: string } | null;
    if (error || !res?.ok) return setMsg(res?.message ?? error?.message ?? `Could not remove ${m.name}.`);
    router.refresh();
  }

  const list = compact ? items.filter((m) => m.last_at) : items;
  if (compact && list.length === 0) return null;

  return (
    <section className={`card flex flex-col ${compact ? "gap-2" : "p-0"}`} aria-label="Medicine">
      {/* On its own screen the title and subtitle say what this is; on another screen, one line. */}
      {compact && (
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">Medicine</h2>
          <Link prefetch={false} href="/baby/medicine" className="text-sm font-semibold text-[var(--accent)]">
            All medicine ›
          </Link>
        </div>
      )}
      {adding && (
        <form
          className="row flex-col px-4"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <input className="input" placeholder="Medicine, e.g. Paracetamol" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <input className="input" placeholder="Usual dose (as on the pack)" value={dose} onChange={(e) => setDose(e.target.value)} />
            <label className="flex items-center gap-2 text-sm">
              <input className="input" type="number" inputMode="decimal" min={0.5} max={168} step={0.5} value={gap} onChange={(e) => setGap(e.target.value)} aria-label="Hours between doses" />
              <span className="shrink-0">h apart</span>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy === "add"}>
              Save
            </button>
          </div>
        </form>
      )}
      <ul className="flex flex-col">
        {list.map((m) => {
          const tooSoon = m.too_soon && m.next_at && Date.parse(m.next_at) > now;
          const mine = given?.medId === m.id;
          return (
            <li key={m.id} className={`row ${compact ? "" : "px-4"} ${tooSoon ? "rounded-xl ring-2 ring-[var(--warn)]" : ""}`}>
              <div className="min-w-0 grow">
                {!compact && canEdit ? (
                  <button type="button" className="block text-left font-semibold" onClick={() => { setManage(manage === m.id ? null : m.id); setConfirmRemove(false); }} aria-expanded={manage === m.id}>
                    {m.name}
                  </button>
                ) : (
                  <p className="font-semibold">{m.name}</p>
                )}
                <p className={`text-sm ${tooSoon ? "font-semibold" : "muted"}`}>
                  {m.dose ? `${m.dose} · ` : ""}
                  {m.last_at
                    ? tooSoon
                      ? `Given ${fmtTime(m.last_at, timezone)}${m.last_by ? ` by ${m.last_by}` : ""} · next from ${fmtTime(m.next_at!, timezone)}`
                      : `Last ${fmtDate(m.last_at, timezone, { weekday: "short" })} ${fmtTime(m.last_at, timezone)}${m.last_by ? ` by ${m.last_by}` : ""}`
                    : "Not given in the last 14 days"}
                  {!compact ? ` · at least ${m.min_gap_hours} h apart` : ""}
                </p>
                {mine && (
                  <p className="mt-1 text-sm font-semibold" role="status">
                    Given {fmtTime(given.at, timezone)}
                    {canDelete && given.entryId && (
                      <>
                        {" · "}
                        <button type="button" className="font-bold text-[var(--accent)] underline" disabled={busy === m.id} onClick={() => void undo()}>
                          Undo
                        </button>
                      </>
                    )}
                  </p>
                )}
                {manage === m.id && (
                  <button type="button" className="mt-1 font-bold text-[var(--danger)]" disabled={busy === m.id} onClick={() => void remove(m)}>
                    {confirmRemove ? "Tap again to remove" : `Remove ${m.name} from the list`}
                  </button>
                )}
                {early?.id === m.id && (
                  <div className="notice notice-warn mt-2 text-sm" role="alert">
                    <p className="font-semibold">{early.message}</p>
                    <p className="mt-1">Only give it now if the doctor said so.</p>
                    <div className="mt-2 flex gap-2">
                      <button type="button" className="btn" onClick={() => setEarly(null)}>
                        Wait
                      </button>
                      <button type="button" className="btn btn-primary" onClick={() => void give(m, true)} disabled={busy === m.id}>
                        The doctor said so
                      </button>
                    </div>
                  </div>
                )}
              </div>
              {canAdd && (
                <button type="button" className={`btn shrink-0 ${tooSoon ? "" : "btn-secondary"}`} disabled={busy === m.id} onClick={() => void give(m)}>
                  Given
                </button>
              )}
            </li>
          );
        })}
        {list.length === 0 && <li className={`row muted text-sm ${compact ? "" : "px-4"}`}>No medicine on the list yet.</li>}
        {!compact && canAdd && !adding && (
          <li className="row px-4">
            <button type="button" className="flex w-full items-center gap-3 text-left font-semibold text-[var(--accent)]" onClick={() => setAdding(true)}>
              <Icon name="plus" size={18} /> Add a medicine
            </button>
          </li>
        )}
      </ul>
      {msg && (
        <p className={`text-sm text-[var(--danger)] ${compact ? "" : "px-4 pb-3"}`} role="alert">
          {msg}
        </p>
      )}
    </section>
  );
}
