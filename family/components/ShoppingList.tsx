"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Category, ShoppingData, ShoppingItem } from "@/lib/types";
import { CATEGORIES, can } from "@/lib/types";
import { useMe } from "@/lib/me-context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ItemForm } from "./ItemForm";
import { Icon } from "@/components/Icon";

export function ShoppingList({ data, members }: { data: ShoppingData; members: { id: string; name: string }[] }) {
  const me = useMe();
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const canAdd = can(me, "shopping", "add");
  const needed = data.items.filter((i) => i.needed);
  const done = data.items.filter((i) => !i.needed);
  const today = new Date().toISOString().slice(0, 10);
  const dueSoon = done.filter((i) => i.due && i.due <= today);

  async function setNeeded(item: ShoppingItem, value: boolean) {
    setBusy(item.id);
    const { data: res } = await supabaseBrowser().rpc("shopping_item_needed", { p_id: item.id, p_needed: value, p_price: null, p_store: null });
    setBusy(null);
    const r = res as { ok: boolean; message?: string } | null;
    if (!r?.ok) return alert(r?.message ?? "Could not save.");
    router.refresh();
  }

  const Group = ({ items, title }: { items: ShoppingItem[]; title?: string }) => (
    <>
      {CATEGORIES.map((c) => {
        const rows = items.filter((i) => i.category === c.id);
        if (rows.length === 0) return null;
        return (
          <section key={(title ?? "") + c.id} className="card">
            <h2 className="text-lg font-bold">
              <span aria-hidden>{c.icon} </span>
              {c.label}
            </h2>
            <ul className="mt-2 flex flex-col gap-2">
              {rows.map((i) => (
                <li key={i.id} className="flex items-center gap-3">
                  <button
                    className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border-2 text-2xl ${i.needed ? "border-[var(--line)]" : "border-green-700 bg-green-50"}`}
                    aria-label={i.needed ? `Mark ${i.name} as bought` : `Put ${i.name} back on the list`}
                    onClick={() => setNeeded(i, !i.needed)}
                    disabled={busy === i.id || !(can(me, "shopping", "edit") || i.owner_member === me.member.id)}
                  >
                    {i.needed ? "" : <Icon name="check" size={18} />}
                  </button>
                  <Link href={`/shopping/${i.id}`} className="flex-1">
                    <span className="block font-semibold">{i.name}</span>
                    <span className="muted block text-sm">
                      {[i.owner_name, i.store_label, i.size ? `size ${i.size}` : null, i.quantity_on_hand ? `${i.quantity_on_hand} left` : null,
                        i.last_bought_on ? `bought ${i.last_bought_on}` : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );

  return (
    <div className="flex flex-col gap-4">
      <header className="page-header page-header-large flex items-center justify-between">
        <h1 className="page-title">Shopping</h1>
        {can(me, "shopping_review", "view") && (
          <Link href="/shopping/requests" className="btn">
            Requests{data.pending_requests ? ` (${data.pending_requests})` : ""}
          </Link>
        )}
      </header>

      {data.pending_requests > 0 && can(me, "shopping_review", "edit") && (
        <Link href="/shopping/requests" className="rounded-2xl border-2 border-amber-700 bg-amber-50 p-4 font-semibold text-amber-900">
          {data.pending_requests} running-low {data.pending_requests === 1 ? "request" : "requests"} to check ›
        </Link>
      )}

      {canAdd && (
        <div className="grid grid-cols-2 gap-2">
          <Link href="/shopping/receipts" className="btn">
            <Icon name="camera" size={20} /> Receipt{data.receipts_to_check ? ` (${data.receipts_to_check})` : ""}
          </Link>
          <Link href="/shopping/cart" className="btn">
            <Icon name="cart" size={20} /> Fill a cart{data.open_carts ? ` (${data.open_carts})` : ""}
          </Link>
        </div>
      )}
      {canAdd && !adding && (
        <button className="btn btn-primary min-h-[64px] text-lg" onClick={() => setAdding(true)}>
          + Add an item
        </button>
      )}
      {adding && <ItemForm item={null} members={members} stores={data.stores} onClose={() => setAdding(false)} />}

      {needed.length === 0 && <p className="muted">Nothing on the list.</p>}
      <Group items={needed} />

      {dueSoon.length > 0 && (
        <section className="card">
          <h2 className="text-lg font-bold">Probably running out</h2>
          <p className="muted text-sm">From how often they were bought: receipts first, the typed interval otherwise.</p>
          <ul className="mt-2 flex flex-col gap-2">
            {dueSoon.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3">
                <span>
                  <span className="font-semibold">{i.name}</span>
                  <span className="muted text-sm"> · due {i.due}</span>
                </span>
                <button className="btn" onClick={() => setNeeded(i, true)} disabled={busy === i.id}>
                  Add to list
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <button className="btn" onClick={() => setShowDone((s) => !s)}>
        {showDone ? "Hide" : "Show"} everything we buy ({done.length})
      </button>
      {showDone && <Group items={done} title="done" />}
    </div>
  );
}
