"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { MilkBottle, MilkData } from "@/lib/types";
import { can } from "@/lib/types";
import { useMe } from "@/lib/me-context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtWhen } from "@/lib/time";
import { Icon } from "@/components/Icon";

const QUICK = [60, 90, 120, 150, 180];

function left(iso: string, now: Date): string {
  const min = Math.round((new Date(iso).getTime() - now.getTime()) / 60000);
  if (min <= 0) return "expired";
  if (min < 60) return `${min} min left`;
  if (min < 48 * 60) return `${Math.floor(min / 60)} h left`;
  return `${Math.round(min / 1440)} days left`;
}


/**
 * Every bottle in the fridge and freezer, oldest first (use that one). Fridge milk keeps
 * 4 days, frozen 6 months, thawed 24 hours, warmed 2 hours. Warmed and used are one tap.
 */
export function MilkStash({ data, timezone }: { data: MilkData; timezone: string }) {
  const me = useMe();
  const router = useRouter();
  const canAdd = can(me, "lana", "add");
  const [amount, setAmount] = useState<number | "">("");
  const [where, setWhere] = useState<"fridge" | "freezer">("fridge");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const now = new Date();
  const fridge = data.bottles.filter((b) => b.location === "fridge" && !b.expired);
  const freezer = data.bottles.filter((b) => b.location === "freezer" && !b.expired);
  const gone = data.bottles.filter((b) => b.expired);

  async function call(fn: string, args: Record<string, unknown>, key: string) {
    setBusy(key);
    setMsg(null);
    const { data: d, error } = await supabaseBrowser().rpc(fn, args);
    setBusy(null);
    const res = d as { ok: boolean; message?: string } | null;
    if (error || !res?.ok) return setMsg(res?.message ?? error?.message ?? "Could not save.");
    router.refresh();
    return true;
  }
  async function add(ml: number) {
    if (await call("milk_add", { p_amount_ml: ml, p_location: where }, "add")) setAmount("");
  }

  // One bottle, stacked so nothing squeezes on a phone: how much and how long it keeps
  // on the first line, when it was pumped under it, the taps on their own row.
  const Bottle = ({ b, first }: { b: MilkBottle; first?: boolean }) => {
    const hoursLeft = (new Date(b.expires_at).getTime() - now.getTime()) / 3_600_000;
    const state = b.warmed_at ? "Warmed" : b.thawed_at ? "Thawed" : null;
    const actions: { label: string; action: string }[] = b.expired
      ? []
      : [
          ...(b.location === "freezer" ? [{ label: "Thaw", action: "fridge" }] : []),
          ...(b.location === "fridge" && !b.warmed_at ? [{ label: "Warmed", action: "warmed" }] : []),
          { label: "Used", action: "used" },
        ];
    return (
      <li className="flex flex-col gap-2 py-3 [&+&]:border-t [&+&]:border-[var(--line)]">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-2">
            <span className="text-xl font-bold">{b.amount_ml} ml</span>
            {first && <span className="pill pill-accent">use first</span>}
          </p>
          <span className={b.expired ? "pill pill-danger" : hoursLeft < 24 ? "pill pill-warn" : "muted text-sm font-semibold"}>
            {state ? `${state} · ` : ""}
            {left(b.expires_at, now)}
          </span>
        </div>
        <p className="muted text-sm">
          {b.location === "freezer" ? "Frozen" : "Pumped"} {fmtWhen(b.pumped_at, timezone, now)}
          {b.note ? ` · ${b.note}` : ""}
        </p>
        {canAdd && (
          <div className="flex gap-2">
            {actions.map((a) => (
              <button key={a.action} type="button" className="chip grow" disabled={busy === b.id} onClick={() => call("milk_move", { p_id: b.id, p_action: a.action }, b.id)}>
                {a.label}
              </button>
            ))}
            <button type="button" className={`chip ${b.expired ? "grow" : ""} text-[var(--muted)]`} disabled={busy === b.id} onClick={() => call("milk_move", { p_id: b.id, p_action: "binned" }, b.id)}>
              Bin
            </button>
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="grid grid-cols-2 gap-3">
        <div className="tile tint-milk">
          <span className="tile-icon">
            <Icon name="bottle" size={20} />
          </span>
          <span>
            <span className="block text-2xl font-bold">{data.fridge_ml} ml</span>
            <span className="muted text-sm">
              in the fridge · {data.fridge_count} {data.fridge_count === 1 ? "bottle" : "bottles"}
              {data.target_ml ? ` · aim ${data.target_ml}` : ""}
            </span>
          </span>
        </div>
        <div className="tile tint-diaper">
          <span className="tile-icon">
            <Icon name="droplet" size={20} />
          </span>
          <span>
            <span className="block text-2xl font-bold">{data.freezer_ml} ml</span>
            <span className="muted text-sm">
              frozen · {data.freezer_count} {data.freezer_count === 1 ? "bottle" : "bottles"}
            </span>
          </span>
        </div>
      </section>

      {canAdd && (
        <section className="card flex flex-col gap-2">
          <h2 className="font-semibold">Put a bottle away</h2>
          <div className="flex gap-2" role="group" aria-label="Where">
            {(["fridge", "freezer"] as const).map((w) => (
              <button key={w} type="button" className="chip" aria-pressed={where === w} onClick={() => setWhere(w)}>
                {w === "fridge" ? "Fridge" : "Freezer"}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {QUICK.map((ml) => (
              <button key={ml} type="button" className="chip" disabled={busy === "add"} onClick={() => add(ml)}>
                {ml} ml
              </button>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (amount) add(Number(amount));
            }}
          >
            <input className="input" type="number" inputMode="numeric" min={5} max={1000} placeholder="Other amount (ml)" value={amount} onChange={(e) => setAmount(e.target.value ? Number(e.target.value) : "")} />
            <button type="submit" className="btn btn-primary shrink-0" disabled={!amount || busy === "add"}>
              Add
            </button>
          </form>
          {msg && <p className="text-sm text-[var(--danger)]">{msg}</p>}
        </section>
      )}

      <section className="card">
        <h2 className="font-semibold">Fridge</h2>
        {fridge.length === 0 ? <p className="muted mt-1 text-sm">Nothing in the fridge.</p> : <ul className="flex flex-col">{fridge.map((b, i) => <Bottle key={b.id} b={b} first={i === 0 && fridge.length > 1} />)}</ul>}
      </section>
      <section className="card">
        <h2 className="font-semibold">Freezer</h2>
        {freezer.length === 0 ? <p className="muted mt-1 text-sm">Nothing frozen.</p> : <ul className="flex flex-col">{freezer.map((b) => <Bottle key={b.id} b={b} />)}</ul>}
      </section>
      {gone.length > 0 && (
        <section className="card">
          <h2 className="font-semibold text-[var(--danger)]">Past its time · bin these</h2>
          <ul className="flex flex-col">{gone.map((b) => <Bottle key={b.id} b={b} />)}</ul>
        </section>
      )}
      <p className="muted text-sm">Fridge milk keeps 4 days, frozen 6 months, thawed 24 hours, warmed 2 hours. Thawed or warmed milk never goes back in the freezer.</p>
    </div>
  );
}
