"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ReceiptDetail, ReceiptLine, RpcError, ShoppingItem, Store } from "@/lib/types";
import { CATEGORIES, can } from "@/lib/types";
import { useMe } from "@/lib/me-context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Photo } from "./Photo";
import { Icon } from "@/components/Icon";

/**
 * One receipt: the lines it was read into, each matched to a list item or
 * flagged. Fix the flagged ones (match, add as new, skip), then apply: that
 * records the purchases and updates last bought / last price.
 */
export function ReceiptReview({ detail, items, stores }: { detail: ReceiptDetail; items: ShoppingItem[]; stores: Store[] }) {
  const me = useMe();
  const router = useRouter();
  const { receipt } = detail;
  const canEdit = can(me, "shopping", "edit");
  const canAdd = can(me, "shopping", "add");
  const locked = receipt.status === "applied" || receipt.status === "discarded";
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [date, setDate] = useState(receipt.bought_on ?? "");
  const [store, setStore] = useState(receipt.store_id ?? "");
  const [total, setTotal] = useState(receipt.total != null ? String(receipt.total) : "");
  const [picking, setPicking] = useState<string | null>(null);

  const lines = detail.lines;
  const matched = lines.filter((l) => l.item_id && l.match !== "skipped").length;
  const flagged = lines.filter((l) => l.match === "unmatched").length;
  const skipped = lines.filter((l) => l.match === "skipped").length;

  async function rpc(name: string, args: Record<string, unknown>, key: string) {
    setBusy(key);
    setMsg(null);
    const { data, error } = await supabaseBrowser().rpc(name, args);
    setBusy(null);
    const res = data as { ok: boolean; message?: string } | null;
    if (error || !res?.ok) {
      setMsg(res?.message ?? error?.message ?? "Could not save.");
      return false;
    }
    router.refresh();
    return true;
  }
  const setLine = (l: ReceiptLine, action: "confirmed" | "added" | "skipped", itemId?: string, category?: string) =>
    rpc("receipt_line_set", { p_line_id: l.id, p_action: action, p_item_id: itemId ?? null, p_name: null, p_category: category ?? null }, l.id).then((ok) => ok && setPicking(null));
  const saveHeader = () => rpc("receipt_update", { p_id: receipt.id, p_bought_on: date || null, p_store_id: store || null, p_total: total ? Number(total) : null, p_status: null }, "header");

  async function apply() {
    if (!date) return setMsg("Set the receipt date first.");
    if (flagged > 0 && !confirm(`${flagged} ${flagged === 1 ? "line is" : "lines are"} not matched to anything and will be left out. Apply anyway?`)) return;
    await saveHeader();
    const { data, error } = await supabaseBrowser().rpc("receipt_apply", { p_id: receipt.id });
    const res = data as { ok: boolean; applied?: number; flagged?: number; message?: string } | null;
    if (error || !res?.ok) return setMsg(res?.message ?? error?.message ?? "Could not apply.");
    setMsg(`Applied: ${res.applied} ${res.applied === 1 ? "purchase" : "purchases"} recorded${res.flagged ? `, ${res.flagged} left out` : ""}.`);
    router.refresh();
  }
  async function reread() {
    setBusy("read");
    setMsg(null);
    const r = await fetch("/api/receipts/read", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: receipt.id }) });
    const out = (await r.json()) as { ok: boolean; message?: string } | RpcError;
    setBusy(null);
    if (!out.ok) setMsg(out.message ?? "Could not read it.");
    router.refresh();
  }

  const stateText = receipt.status === "applied" ? "Applied to the list" : receipt.status === "discarded" ? "Discarded" : receipt.status === "new" ? "Not read yet" : `${matched} of ${lines.length - skipped} lines matched${flagged ? `, ${flagged} to check` : ""}`;

  return (
    <div className="flex flex-col gap-4">
      <header className="page-header flex items-center gap-2">
        <Link href="/shopping/receipts" className="icon-btn" aria-label="Back">
          <Icon name="back" size={24} />
        </Link>
        <div>
          <h1 className="page-title">Receipt</h1>
          <p className="muted text-sm">{stateText}</p>
        </div>
      </header>

      <section className="card flex flex-col gap-2">
        <div className="flex gap-3">
          <Photo path={receipt.photo_path} alt="Receipt" className="h-32 w-24 shrink-0" />
          <div className="flex flex-1 flex-col gap-2">
            <select className="input" value={store} onChange={(e) => setStore(e.target.value)} disabled={locked} aria-label="Shop">
              <option value="">{receipt.store_name ? `Shop: ${receipt.store_name}` : "Which shop?"}</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={locked} aria-label="Date" />
            <input className="input" type="number" inputMode="decimal" step="0.01" value={total} onChange={(e) => setTotal(e.target.value)} placeholder={`Total${receipt.currency ? ` (${receipt.currency})` : ""}`} disabled={locked} aria-label="Total" />
          </div>
        </div>
        {!locked && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn" onClick={saveHeader} disabled={busy !== null}>
              Save details
            </button>
            <button type="button" className="btn" onClick={reread} disabled={busy !== null}>
              {busy === "read" ? "Reading…" : "Read again"}
            </button>
            <button type="button" className="btn btn-danger" onClick={() => confirm("Discard this receipt?") && rpc("receipt_update", { p_id: receipt.id, p_status: "discarded" }, "discard")} disabled={busy !== null}>
              Discard
            </button>
          </div>
        )}
      </section>

      <section className="card">
        <h2 className="text-lg font-bold">Lines</h2>
        {lines.length === 0 && <p className="muted mt-1">Nothing read yet. {receipt.status === "new" ? "Tap “Read again”." : "Try a clearer photo."}</p>}
        <ol className="mt-2 flex flex-col gap-3">
          {lines.map((l) => {
            const ok = l.item_id && l.match !== "skipped";
            const cls = l.match === "skipped" ? "opacity-50" : l.match === "unmatched" ? "border-l-4 border-[var(--warn)] pl-3" : "border-l-4 border-green-700 pl-3";
            return (
              <li key={l.id} className={cls}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{l.text}</p>
                    <p className="muted text-sm">
                      {l.qty && l.qty !== 1 ? `${l.qty} × ` : ""}
                      {l.unit_price != null ? `${l.unit_price}` : l.line_total != null ? `${l.line_total}` : "no price"}
                      {l.line_total != null && l.qty && l.qty !== 1 ? ` = ${l.line_total}` : ""}
                    </p>
                    {ok ? (
                      <p className="text-sm text-[var(--ok)]">
                        → {l.item_name}
                        {l.match === "auto" && l.confidence != null && l.confidence < 0.9 ? ` (probably · ${Math.round(l.confidence * 100)}%)` : ""}
                        {l.match === "added" ? " (new)" : ""}
                      </p>
                    ) : l.match === "skipped" ? (
                      <p className="muted text-sm">skipped</p>
                    ) : (
                      <p className="text-sm font-semibold text-[var(--warn)]">Not on the list</p>
                    )}
                  </div>
                  {!locked && canAdd && (
                    <button type="button" className="btn" onClick={() => setPicking(picking === l.id ? null : l.id)} disabled={busy !== null}>
                      {ok ? "Change" : "Fix"}
                    </button>
                  )}
                </div>
                {picking === l.id && !locked && (
                  <div className="mt-2 flex flex-col gap-2 rounded-xl border border-[var(--line)] p-2">
                    <select className="input" defaultValue="" onChange={(e) => e.target.value && setLine(l, "confirmed", e.target.value)} aria-label="Match to an item" disabled={busy !== null}>
                      <option value="">Match to an item on the list…</option>
                      {items.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name}
                          {i.size ? ` · ${i.size}` : ""}
                        </option>
                      ))}
                    </select>
                    <div className="flex flex-wrap gap-2">
                      {CATEGORIES.map((c) => (
                        <button key={c.id} type="button" className="chip" onClick={() => setLine(l, "added", undefined, c.id)} disabled={busy !== null}>
                          + New {c.label.toLowerCase()} item
                        </button>
                      ))}
                      <button type="button" className="chip" onClick={() => setLine(l, "skipped")} disabled={busy !== null}>
                        Skip (not a list thing)
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      {msg && (
        <p role="status" className={`notice ${msg.startsWith("Applied") ? "notice-ok" : "notice-danger"}`}>
          {msg}
        </p>
      )}
      {!locked && lines.length > 0 && (
        <button type="button" className="btn btn-primary min-h-[64px] text-lg" onClick={apply} disabled={busy !== null || !canEdit} title={canEdit ? "" : "Only Mido or Dana can apply a receipt"}>
          Apply to the list ({matched} {matched === 1 ? "item" : "items"})
        </button>
      )}
      {receipt.status === "applied" && (
        <Link href="/shopping" className="btn">
          Back to the list
        </Link>
      )}
    </div>
  );
}
