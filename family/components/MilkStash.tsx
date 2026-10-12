"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { MilkBottle, MilkData } from "@/lib/types";
import { can } from "@/lib/types";
import { useMe } from "@/lib/me-context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtDate, fmtTime } from "@/lib/time";
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

  const Bottle = ({ b }: { b: MilkBottle }) => (
    <li className="row">
      <span className={`dot ${b.expired ? "dot-danger" : b.warmed_at ? "dot-warn" : "dot-ok"}`} />
      <div className="min-w-0 grow">
        <p className="font-semibold">
          {b.amount_ml} ml
          <span className="muted font-normal"> · pumped {fmtDate(b.pumped_at, timezone, { weekday: "short" })} {fmtTime(b.pumped_at, timezone)}</span>
        </p>
        <p className="muted text-sm">
          {b.warmed_at ? "Warmed · " : b.thawed_at ? "Thawed · " : ""}
          {left(b.expires_at, now)}
          {b.note ? ` · ${b.note}` : ""}
        </p>
      </div>
      {canAdd && (
        <div className="flex shrink-0 gap-1">
          {b.location === "freezer" && !b.expired && (
            <button type="button" className="chip" style={{ minHeight: 36, padding: "4px 12px" }} disabled={busy === b.id} onClick={() => call("milk_move", { p_id: b.id, p_action: "fridge" }, b.id)}>
              Thaw
            </button>
          )}
          {b.location === "fridge" && !b.warmed_at && !b.expired && (
            <button type="button" className="chip" style={{ minHeight: 36, padding: "4px 12px" }} disabled={busy === b.id} onClick={() => call("milk_move", { p_id: b.id, p_action: "warmed" }, b.id)}>
              Warmed
            </button>
          )}
          {!b.expired && (
            <button type="button" className="chip" style={{ minHeight: 36, padding: "4px 12px" }} disabled={busy === b.id} onClick={() => call("milk_move", { p_id: b.id, p_action: "used" }, b.id)}>
              Used
            </button>
          )}
          <button type="button" className="icon-btn m-0 text-[var(--muted)]" style={{ width: 36, height: 36, minHeight: 36 }} aria-label="Bin it" disabled={busy === b.id} onClick={() => call("milk_move", { p_id: b.id, p_action: "binned" }, b.id)}>
            <Icon name="x" size={16} />
          </button>
        </div>
      )}
    </li>
  );

  return (
    <div className="flex flex-col gap-4">
      <section className="grid grid-cols-2 gap-3">
        <div className="tile">
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
        <div className="tile">
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
        <h2 className="font-semibold">Fridge · use the top one first</h2>
        {fridge.length === 0 ? <p className="muted mt-1 text-sm">Nothing in the fridge.</p> : <ul className="mt-1 flex flex-col">{fridge.map((b) => <Bottle key={b.id} b={b} />)}</ul>}
      </section>
      <section className="card">
        <h2 className="font-semibold">Freezer</h2>
        {freezer.length === 0 ? <p className="muted mt-1 text-sm">Nothing frozen.</p> : <ul className="mt-1 flex flex-col">{freezer.map((b) => <Bottle key={b.id} b={b} />)}</ul>}
      </section>
      {gone.length > 0 && (
        <section className="card">
          <h2 className="font-semibold text-[var(--danger)]">Past its time · bin these</h2>
          <ul className="mt-1 flex flex-col">{gone.map((b) => <Bottle key={b.id} b={b} />)}</ul>
        </section>
      )}
      <p className="muted text-sm">Fridge milk keeps 4 days, frozen 6 months, thawed 24 hours, warmed 2 hours. Thawed or warmed milk never goes back in the freezer.</p>
    </div>
  );
}
