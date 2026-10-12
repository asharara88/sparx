"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Category, ShoppingItem, Store } from "@/lib/types";
import { CATEGORIES, can } from "@/lib/types";
import { useMe } from "@/lib/me-context";
import { supabaseBrowser } from "@/lib/supabase/client";

export function ItemForm({
  item,
  members,
  stores,
  onClose,
}: {
  item: ShoppingItem | null;
  members: { id: string; name: string }[];
  stores: Store[];
  onClose: () => void;
}) {
  const me = useMe();
  const router = useRouter();
  const [name, setName] = useState(item?.name ?? "");
  const [category, setCategory] = useState<Category>(item?.category ?? "groceries");
  const [owner, setOwner] = useState(item?.owner_member ?? "");
  const [store, setStore] = useState(item?.store_id ?? "");
  const [url, setUrl] = useState(item?.product_url ?? "");
  const [qty, setQty] = useState(item?.quantity_on_hand ?? "");
  const [size, setSize] = useState(item?.size ?? "");
  const [lastBought, setLastBought] = useState(item?.last_bought_on ?? "");
  const [price, setPrice] = useState(item?.last_price != null ? String(item.last_price) : "");
  const [reorder, setReorder] = useState(item?.reorder_days != null ? String(item.reorder_days) : "");
  const [needed, setNeeded] = useState(item?.needed ?? true);
  const [note, setNote] = useState(item?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [more, setMore] = useState(!!item);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { data, error } = await supabaseBrowser().rpc("shopping_item_save", {
      p_id: item?.id ?? null,
      p_name: name,
      p_category: category,
      p_owner_member: owner || null,
      p_store_id: store || null,
      p_product_url: url || null,
      p_quantity_on_hand: qty || null,
      p_size: size || null,
      p_last_bought_on: lastBought || null,
      p_last_price: price ? Number(price) : null,
      p_reorder_days: reorder ? Number(reorder) : null,
      p_needed: needed,
      p_note: note || null,
    });
    setBusy(false);
    const res = data as { ok: boolean; message?: string } | null;
    if (error || !res?.ok) return setMsg(res?.message ?? error?.message ?? "Could not save.");
    onClose();
    router.refresh();
  }

  async function remove() {
    if (!item || !confirm(`Remove ${item.name} from the list for good?`)) return;
    setBusy(true);
    const { data } = await supabaseBrowser().rpc("shopping_item_remove", { p_id: item.id });
    setBusy(false);
    const res = data as { ok: boolean; message?: string } | null;
    if (!res?.ok) return setMsg(res?.message ?? "Could not remove.");
    router.push("/shopping");
    router.refresh();
  }

  return (
    <form onSubmit={save} className="card flex flex-col gap-3 border-[var(--accent)]">
      <h2 className="text-lg font-semibold">{item ? item.name : "New item"}</h2>
      <label className="flex flex-col gap-1">
        <span className="font-semibold">Name</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Nappies size 3" />
      </label>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Category">
        {CATEGORIES.map((c) => (
          <button key={c.id} type="button" className="chip" aria-pressed={category === c.id} onClick={() => setCategory(c.id)}>
            <span aria-hidden>{c.icon} </span>
            {c.label}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-3">
        <input type="checkbox" className="h-7 w-7" checked={needed} onChange={(e) => setNeeded(e.target.checked)} />
        <span className="font-semibold">We need it now</span>
      </label>
      {!more ? (
        <button type="button" className="btn" onClick={() => setMore(true)}>
          More details (shop, link, size, price…)
        </button>
      ) : (
        <>
          <label className="flex flex-col gap-1">
            <span className="font-semibold">Whose item</span>
            <select className="input" value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">The household</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-semibold">Usual shop</span>
            <select className="input" value={store} onChange={(e) => setStore(e.target.value)}>
              <option value="">Not set</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-semibold">Product link (optional)</span>
            <input className="input" type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="font-semibold">How many left</span>
              <input className="input" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="e.g. 2 packs" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-semibold">Size</span>
              <input className="input" value={size} onChange={(e) => setSize(e.target.value)} placeholder="e.g. 3 or 6-9 m" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-semibold">Last bought</span>
              <input className="input" type="date" value={lastBought} onChange={(e) => setLastBought(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-semibold">Last price (AED)</span>
              <input className="input" type="number" inputMode="decimal" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-semibold">Buy again every (days)</span>
              <input className="input" type="number" inputMode="numeric" value={reorder} onChange={(e) => setReorder(e.target.value)} placeholder="e.g. 30" />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="font-semibold">Note</span>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </>
      )}
      {msg && (
        <p role="alert" className="notice notice-danger">
          {msg}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <button type="button" className="btn" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
      {item && can(me, "shopping", "delete") && (
        <button type="button" className="btn btn-danger" onClick={remove} disabled={busy}>
          Remove for good
        </button>
      )}
    </form>
  );
}
