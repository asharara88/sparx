"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CartRunRow, ShoppingData, ShoppingItem, Substitution } from "@/lib/types";
import { SUBSTITUTIONS, can } from "@/lib/types";
import { useMe } from "@/lib/me-context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtDate } from "@/lib/time";
import { PageHeader } from "@/components/PageHeader";

/** Pick a shop and the items to put in its cart; the substitution rule sits on each item. */
export function CartBuilder({ data, runs }: { data: ShoppingData; runs: CartRunRow[] }) {
  const me = useMe();
  const router = useRouter();
  const shops = data.stores.filter((s) => s.id !== "other");
  const [store, setStore] = useState(shops[0]?.id ?? "");
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const candidates = data.items.filter((i) => (all || i.needed) && (i.store_id === store || !i.store_id || all));
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(data.items.filter((i) => i.needed && (i.store_id === store || !i.store_id)).map((i) => i.id)));
  const canAdd = can(me, "shopping", "add");

  function pickStore(id: string) {
    setStore(id);
    setChosen(new Set(data.items.filter((i) => i.needed && (i.store_id === id || !i.store_id)).map((i) => i.id)));
  }
  function toggle(id: string) {
    setChosen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  async function setRule(item: ShoppingItem, rule: Substitution) {
    const { data: res } = await supabaseBrowser().rpc("shopping_item_substitution", { p_id: item.id, p_rule: rule });
    const r = res as { ok: boolean; message?: string } | null;
    if (!r?.ok) return setMsg(r?.message ?? "Could not save.");
    router.refresh();
  }
  async function prepare() {
    setBusy(true);
    setMsg(null);
    const { data: res, error } = await supabaseBrowser().rpc("cart_run_create", { p_store_id: store, p_item_ids: Array.from(chosen), p_note: null });
    setBusy(false);
    const r = res as { ok: boolean; id?: string; message?: string } | null;
    if (error || !r?.ok || !r.id) return setMsg(r?.message ?? error?.message ?? "Could not prepare the cart.");
    router.push(`/shopping/cart/${r.id}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/shopping" title="Fill a cart" />
      <p className="muted text-sm">Pick the shop and the items. You get the instructions for the cart agent; it fills the cart and stops at checkout. You pay.</p>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Shop">
        {shops.map((s) => (
          <button key={s.id} type="button" className="chip" aria-pressed={store === s.id} onClick={() => pickStore(s.id)}>
            {s.label}
          </button>
        ))}
      </div>

      <section className="card">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-bold">Items ({chosen.size})</h2>
          <button type="button" className="text-sm font-semibold text-[var(--accent)]" onClick={() => setAll((a) => !a)}>
            {all ? "Only what is needed" : "Show everything"}
          </button>
        </div>
        {candidates.length === 0 && <p className="muted mt-1">Nothing needed for this shop. Tick items on the list first, or show everything.</p>}
        <ul className="mt-2 flex flex-col gap-3">
          {candidates.map((i) => (
            <li key={i.id} className="border-b border-[var(--line)] pb-2 last:border-0">
              <label className="flex items-center gap-3">
                <input type="checkbox" className="h-7 w-7" checked={chosen.has(i.id)} onChange={() => toggle(i.id)} />
                <span className="flex-1">
                  <span className="block font-semibold">{i.name}</span>
                  <span className="muted block text-sm">
                    {[i.size ? `size ${i.size}` : null, i.last_price != null ? `last ${i.last_price} ${me.household.currency}` : null, i.store_label && i.store_id !== store ? `usually ${i.store_label}` : null].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </label>
              {chosen.has(i.id) && (
                <div className="mt-1 flex flex-wrap gap-1 pl-10" role="group" aria-label={`Substitution for ${i.name}`}>
                  {SUBSTITUTIONS.map((s) => (
                    <button key={s.id} type="button" className="chip text-sm" style={{ padding: "6px 12px", minHeight: 40 }} aria-pressed={i.substitution === s.id} onClick={() => setRule(i, s.id)} title={s.hint}>
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      {msg && (
        <p role="alert" className="notice notice-danger">
          {msg}
        </p>
      )}
      <button type="button" className="btn btn-primary min-h-[64px] text-lg" onClick={prepare} disabled={busy || chosen.size === 0 || !canAdd}>
        {busy ? "Preparing…" : `Prepare the cart (${chosen.size})`}
      </button>

      {runs.length > 0 && (
        <section className="card">
          <h2 className="text-lg font-bold">Earlier carts</h2>
          <ul className="mt-2 flex flex-col gap-2">
            {runs.map((r) => (
              <li key={r.id}>
                <Link href={`/shopping/cart/${r.id}`} className="flex justify-between gap-2">
                  <span>
                    <b>{r.store_label}</b> · {r.items} items · {fmtDate(r.created_at, me.household.timezone)}
                  </span>
                  <span className="muted">{r.status === "reported" ? `${r.found} found · ${r.substituted} subst. · ${r.missing} missing` : r.status}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
