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
import { Fold, type Tint } from "@/components/Fold";
import type { IconName } from "@/components/Icon";

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
          <span className="muted line-clamp-2 block text-sm">
            {state ?? (b.location === "freezer" ? "Frozen" : "Pumped")} {fmtWhen(b.warmed_at ?? b.thawed_at ?? b.pumped_at, timezone, now)}
            {b.note ? ` · ${b.note}` : ""}
          </span>
        </span>
        <span className={b.expired ? "pill pill-danger" : hoursLeft < 24 ? "pill pill-warn" : "muted shrink-0 whitespace-nowrap text-sm font-semibold"}>{left(b.expires_at, now)}</span>
      </>
    );
    return (
      <li className="row">
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

  // Fridge, freezer and what is past its time: one card each that opens to its bottles (Mido,
  // 9 November: a long list of bottle cards was a mess to the eye). The closed card says
  // how many and how much; past its time opens by itself, it needs doing.
  // Called as a function, not mounted as <Group>: a component defined in here is a new type on
  // every render, so tapping a bottle (a state change) would remount the fold and close it.
  const group = ({ title, bottles, empty, firstFlag, tint, icon, open = false }: { title: string; bottles: MilkBottle[]; empty: string; firstFlag?: boolean; tint: Tint; icon: IconName; open?: boolean }) => {
    const ml = bottles.reduce((n, b) => n + b.amount_ml, 0);
    const hint = bottles.length ? `${bottles.length} ${bottles.length === 1 ? "bottle" : "bottles"} · ${ml} ml` : "empty";
    return (
      <Fold title={title} hint={hint} icon={icon} tint={tint} open={open}>
        {bottles.length === 0 ? (
          <p className="muted px-1 text-sm">{empty}</p>
        ) : (
          <ul className="flex flex-col p-0">
            {bottles.map((b, i) => (
              <Row key={b.id} b={b} first={firstFlag && i === 0 && bottles.length > 1} />
            ))}
          </ul>
        )}
      </Fold>
    );
  };

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
      {gone.length > 0 && group({ title: "Past its time", bottles: gone, empty: "", tint: "danger", icon: "clock", open: true })}
      {group({ title: "Fridge", bottles: fridge, empty: "Nothing in the fridge.", firstFlag: true, tint: "milk", icon: "droplet" })}
      {group({ title: "Freezer", bottles: freezer, empty: "Nothing frozen.", tint: "diaper", icon: "inbox" })}

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
          <div className="segmented" role="group" aria-label="Where">
            {(["fridge", "freezer"] as const).map((w) => (
              <button key={w} type="button" aria-pressed={where === w} onClick={() => setWhere(w)}>
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
