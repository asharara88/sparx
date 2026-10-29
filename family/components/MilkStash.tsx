"use client";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { MilkBottle, MilkData } from "@/lib/types";
import { can } from "@/lib/types";
import { useMe } from "@/lib/me-context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtWhen } from "@/lib/time";
import { Icon } from "@/components/Icon";
import { Sheet } from "@/components/Sheet";
import { MilkScan } from "@/components/MilkScan";

const QUICK = [60, 90, 120, 150, 180];

function left(iso: string, now: Date): string {
  const min = Math.round((new Date(iso).getTime() - now.getTime()) / 60000);
  if (min <= 0) return "expired";
  if (min < 60) return `${min} min left`;
  if (min < 48 * 60) return `${Math.floor(min / 60)} h left`;
  return `${Math.round(min / 1440)} days left`;
}

async function milkCall(fn: string, args: Record<string, unknown>): Promise<string | null> {
  const { data, error } = await supabaseBrowser().rpc(fn, args);
  const res = data as { ok: boolean; message?: string } | null;
  return error || !res?.ok ? (res?.message ?? error?.message ?? "Could not save.") : null;
}

/**
 * The fridge and freezer (DESIGN.md, "Milk"): the two totals, then every bottle as a list
 * row, oldest first (use that one). Tapping a bottle opens a sheet with Warmed (or Thaw),
 * Used and Bin. Fridge milk keeps 4 days, frozen 6 months, thawed 24 hours, warmed 2 hours.
 */
export function MilkStash({ data, timezone }: { data: MilkData; timezone: string }) {
  const me = useMe();
  const router = useRouter();
  const canAdd = can(me, "lana", "add");
  const [open, setOpen] = useState<MilkBottle | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const close = useCallback(() => {
    setOpen(null);
    setMsg(null);
  }, []);
  const now = new Date();
  const fridge = data.bottles.filter((b) => b.location === "fridge" && !b.expired);
  const freezer = data.bottles.filter((b) => b.location === "freezer" && !b.expired);
  const gone = data.bottles.filter((b) => b.expired);

  async function move(b: MilkBottle, action: string) {
    setBusy(true);
    const err = await milkCall("milk_move", { p_id: b.id, p_action: action });
    setBusy(false);
    if (err) return setMsg(err);
    close();
    router.refresh();
  }

  // One bottle, one row: how much (and "use first") over when it was pumped; how long it
  // keeps on the right, a pill only when it is close or past.
  const Row = ({ b, first }: { b: MilkBottle; first?: boolean }) => {
    const hoursLeft = (new Date(b.expires_at).getTime() - now.getTime()) / 3_600_000;
    const state = b.warmed_at ? "Warmed" : b.thawed_at ? "Thawed" : null;
    const inner = (
      <>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-lg font-bold">{b.amount_ml} ml</span>
            {first && <span className="pill pill-accent">use first</span>}
          </span>
          <span className="muted block truncate text-sm">
            {state ?? (b.location === "freezer" ? "Frozen" : "Pumped")} {fmtWhen(b.warmed_at ?? b.thawed_at ?? b.pumped_at, timezone, now)}
            {b.note ? ` · ${b.note}` : ""}
          </span>
        </span>
        <span className={b.expired ? "pill pill-danger" : hoursLeft < 24 ? "pill pill-warn" : "muted shrink-0 text-sm font-semibold"}>{left(b.expires_at, now)}</span>
      </>
    );
    return (
      <li className="row px-4">
        {canAdd ? (
          <button type="button" className="flex w-full items-center gap-3 text-left" onClick={() => setOpen(b)} aria-label={`${b.amount_ml} ml, ${left(b.expires_at, now)}`}>
            {inner}
          </button>
        ) : (
          <div className="flex w-full items-center gap-3">{inner}</div>
        )}
      </li>
    );
  };

  const Group = ({ title, bottles, empty, firstFlag, danger }: { title: string; bottles: MilkBottle[]; empty: string; firstFlag?: boolean; danger?: boolean }) => (
    <section className="flex flex-col gap-2">
      <h2 className={`section-title ${danger ? "text-[var(--danger)]" : ""}`}>{title}</h2>
      {bottles.length === 0 ? (
        <p className="muted px-1 text-sm">{empty}</p>
      ) : (
        <ul className="card flex flex-col p-0">
          {bottles.map((b, i) => (
            <Row key={b.id} b={b} first={firstFlag && i === 0 && bottles.length > 1} />
          ))}
        </ul>
      )}
    </section>
  );

  const actions: { label: string; action: string; primary?: boolean }[] = !open
    ? []
    : open.expired
      ? [{ label: "Bin it", action: "binned", primary: true }]
      : [
          ...(open.location === "freezer" ? [{ label: "Thaw it (to the fridge)", action: "fridge", primary: true }] : []),
          ...(open.location === "fridge" && !open.warmed_at ? [{ label: "Warmed for a feed", action: "warmed", primary: true }] : []),
          { label: "Used", action: "used" },
          { label: "Bin it", action: "binned" },
        ];

  return (
    <>
      <section className="grid grid-cols-2 gap-3">
        <div className="tile tint-milk">
          <span className="block text-2xl font-bold">{data.fridge_ml} ml</span>
          <span className="text-sm">in the fridge</span>
        </div>
        <div className="tile tint-diaper">
          <span className="block text-2xl font-bold">{data.freezer_ml} ml</span>
          <span className="text-sm">in the freezer</span>
        </div>
      </section>
      <Group title="Fridge" bottles={fridge} empty="Nothing in the fridge." firstFlag />
      <Group title="Freezer" bottles={freezer} empty="Nothing frozen." />
      {gone.length > 0 && <Group title="Past its time" bottles={gone} empty="" danger />}

      {open && (
        <Sheet title={`${open.amount_ml} ml`} onClose={close}>
          <p className="muted">
            {open.location === "freezer" ? "Frozen" : "Pumped"} {fmtWhen(open.pumped_at, timezone, now)} · {left(open.expires_at, now)}
          </p>
          {actions.map((a) => (
            <button key={a.action} type="button" className={`btn btn-lg w-full ${a.primary ? "btn-primary" : ""}`} disabled={busy} onClick={() => void move(open, a.action)}>
              {a.label}
            </button>
          ))}
          {msg && <p className="text-sm text-[var(--danger)]">{msg}</p>}
        </Sheet>
      )}
    </>
  );
}

/** "Put a bottle away", the Milk screen's one bottom button: a sheet with fridge or freezer, the amounts, and a photo of a label. */
export function MilkPutAway({ timezone, canScan }: { timezone: string; canScan: boolean }) {
  const me = useMe();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<number | "">("");
  const [where, setWhere] = useState<"fridge" | "freezer">("fridge");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const close = useCallback(() => {
    setOpen(false);
    setMsg(null);
    setAmount("");
  }, []);
  if (!can(me, "lana", "add")) return null;

  async function add(ml: number) {
    setBusy(true);
    const err = await milkCall("milk_add", { p_amount_ml: ml, p_location: where });
    setBusy(false);
    if (err) return setMsg(err);
    close();
    router.refresh();
  }

  return (
    <>
      <div className="bottom-action">
        <button type="button" className="btn btn-primary btn-lg w-full" onClick={() => setOpen(true)}>
          <Icon name="plus" size={20} /> Put a bottle away
        </button>
      </div>
      {open && (
        <Sheet title="Put a bottle away" onClose={close}>
          <div className="grid grid-cols-2 gap-1 rounded-2xl bg-[var(--card-2)] p-1" role="group" aria-label="Where">
            {(["fridge", "freezer"] as const).map((w) => (
              <button key={w} type="button" aria-pressed={where === w} onClick={() => setWhere(w)} className={`min-h-[44px] rounded-xl text-sm font-bold ${where === w ? "bg-[var(--card)] shadow-[var(--shadow)]" : "muted"}`}>
                {w === "fridge" ? "Fridge" : "Freezer"}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-5 gap-2">
            {QUICK.map((ml) => (
              <button key={ml} type="button" className="chip justify-center px-0" disabled={busy} onClick={() => void add(ml)}>
                {ml} ml
              </button>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (amount) void add(Number(amount));
            }}
          >
            <input className="input" type="number" inputMode="numeric" min={5} max={1000} placeholder="Other amount (ml)" value={amount} onChange={(e) => setAmount(e.target.value ? Number(e.target.value) : "")} />
            <button type="submit" className="btn btn-primary shrink-0" disabled={!amount || busy}>
              Add
            </button>
          </form>
          {msg && <p className="text-sm text-[var(--danger)]">{msg}</p>}
          {canScan && <MilkScan bare timezone={timezone} />}
          <p className="muted text-sm">Milk keeps 4 days in the fridge and 6 months frozen; thawed, 24 hours; warmed, 2 hours. Thawed or warmed milk never goes back in the freezer.</p>
        </Sheet>
      )}
    </>
  );
}
