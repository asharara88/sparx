"use client";
import { useState } from "react";
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
 * Lana's log; if the gap has not passed the button asks a second time and says
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
  const now = Date.now();

  async function give(m: Medicine, force = false) {
    setBusy(m.id);
    setMsg(null);
    setEarly(null);
    const { data, error } = await supabaseBrowser().rpc("medicine_give", { p_id: m.id, p_dose: null, p_occurred_at: new Date().toISOString(), p_note: null, p_force: force });
    const res = data as { ok: boolean; error?: string; message?: string } | null;
    setBusy(null);
    if (error || !res) return setMsg(error?.message ?? "Could not save.");
    if (!res.ok && res.error === "too_soon") return setEarly({ id: m.id, message: res.message ?? "Too early." });
    if (!res.ok) return setMsg(res.message ?? "Could not save.");
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
    if (!window.confirm(`Remove ${m.name} from the list? Doses already logged stay in the log.`)) return;
    setBusy(m.id);
    await supabaseBrowser().rpc("medicine_remove", { p_id: m.id });
    setBusy(null);
    router.refresh();
  }

  const list = compact ? items.filter((m) => m.last_at) : items;
  if (compact && list.length === 0) return null;

  return (
    <section className="card flex flex-col gap-2" aria-labelledby="meds-h">
      <div className="flex items-center justify-between gap-2">
        <h2 id="meds-h" className="font-semibold">
          Medicine
        </h2>
        {compact ? (
          <Link href="/lana/medicine" className="text-sm font-semibold text-[var(--accent)]">
            All medicine ›
          </Link>
        ) : (
          canAdd && (
            <button type="button" className="btn" style={{ minHeight: 40 }} onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
              <Icon name="plus" size={18} /> Add
            </button>
          )
        )}
      </div>
      {!compact && <p className="muted text-sm">The app only checks the hours between doses. How much to give is what the doctor or the pack says.</p>}
      {adding && (
        <form
          className="flex flex-col gap-2 rounded-xl bg-[var(--card-2)] p-3"
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
          <button type="submit" className="btn btn-primary" disabled={busy === "add"}>
            Save
          </button>
        </form>
      )}
      <ul className="flex flex-col">
        {list.map((m) => {
          const tooSoon = m.too_soon && m.next_at && Date.parse(m.next_at) > now;
          return (
            <li key={m.id} className={`row ${tooSoon ? "rounded-xl ring-2 ring-[var(--warn)]" : ""}`}>
              <div className="min-w-0 grow">
                <p className="font-semibold">
                  {m.name}
                  {m.dose ? <span className="muted font-normal"> · {m.dose}</span> : ""}
                </p>
                <p className={`text-sm ${tooSoon ? "font-semibold" : "muted"}`}>
                  {m.last_at
                    ? tooSoon
                      ? `Given ${fmtTime(m.last_at, timezone)}${m.last_by ? ` by ${m.last_by}` : ""} · next from ${fmtTime(m.next_at!, timezone)}`
                      : `Last ${fmtDate(m.last_at, timezone, { weekday: "short" })} ${fmtTime(m.last_at, timezone)}${m.last_by ? ` by ${m.last_by}` : ""}`
                    : "Not given in the last 14 days"}
                  {!compact ? ` · at least ${m.min_gap_hours} h apart` : ""}
                </p>
                {early?.id === m.id && (
                  <div className="notice notice-warn mt-2 text-sm" role="alert">
                    <p className="font-semibold">{early.message}</p>
                    <p className="mt-1">Only give it now if the doctor said so.</p>
                    <div className="mt-2 flex gap-2">
                      <button type="button" className="btn" style={{ minHeight: 40 }} onClick={() => setEarly(null)}>
                        Wait
                      </button>
                      <button type="button" className="btn btn-primary" style={{ minHeight: 40 }} onClick={() => void give(m, true)} disabled={busy === m.id}>
                        The doctor said so
                      </button>
                    </div>
                  </div>
                )}
              </div>
              {canAdd && (
                <div className="flex shrink-0 gap-1">
                  <button type="button" className={`btn ${tooSoon ? "" : "btn-primary"}`} style={{ minHeight: 40 }} disabled={busy === m.id} onClick={() => void give(m)}>
                    Given
                  </button>
                  {!compact && canEdit && (
                    <button type="button" className="icon-btn m-0 text-[var(--muted)]" style={{ width: 40, height: 40, minHeight: 40 }} aria-label={`Remove ${m.name}`} disabled={busy === m.id} onClick={() => void remove(m)}>
                      <Icon name="x" size={16} />
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
        {list.length === 0 && <li className="muted text-sm">No medicine on the list yet.</li>}
      </ul>
      {msg && (
        <p className="text-sm text-[var(--danger)]" role="alert">
          {msg}
        </p>
      )}
    </section>
  );
}
