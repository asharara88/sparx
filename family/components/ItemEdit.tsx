"use client";
import { useRouter } from "next/navigation";
import type { Purchase, ShoppingItem, Store, Substitution } from "@/lib/types";
import { SUBSTITUTIONS } from "@/lib/types";
import { useMe } from "@/lib/me-context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ItemForm } from "./ItemForm";
import { Photo } from "./Photo";

export function ItemEdit({ item, stores, members, purchases = [] }: { item: ShoppingItem; stores: Store[]; members: { id: string; name: string }[]; purchases?: Purchase[] }) {
  const router = useRouter();
  const me = useMe();
  async function setRule(rule: Substitution) {
    const { data } = await supabaseBrowser().rpc("shopping_item_substitution", { p_id: item.id, p_rule: rule });
    if ((data as { ok: boolean } | null)?.ok) router.refresh();
  }
  return (
    <>
      {item.photo_path && <Photo path={item.photo_path} alt={item.name} className="h-48 w-full" />}
      <section className="card">
        <h2 className="font-semibold">If the shop does not have it</h2>
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Substitution">
          {SUBSTITUTIONS.map((s) => (
            <button key={s.id} type="button" className="chip" aria-pressed={item.substitution === s.id} onClick={() => setRule(s.id)} title={s.hint}>
              {s.label}
            </button>
          ))}
        </div>
        <p className="muted mt-1 text-sm">{SUBSTITUTIONS.find((s) => s.id === item.substitution)?.hint}</p>
      </section>
      <section className="card">
        <h2 className="font-semibold">Bought</h2>
        <p className="muted text-sm">
          {item.reorder_days_learned
            ? `About every ${item.reorder_days_learned} days, from ${item.purchases} receipts${item.reorder_days ? ` (you typed ${item.reorder_days})` : ""}.`
            : item.reorder_days
              ? `Every ${item.reorder_days} days (typed). Two receipts and it learns the real interval.`
              : "No interval yet. Two receipts and it learns one."}
        </p>
        {purchases.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {purchases.slice(0, 8).map((p) => (
              <li key={p.id} className="flex justify-between gap-2">
                <span>
                  {p.bought_on}
                  {p.store ? ` · ${p.store}` : ""}
                  {p.line ? ` · ${p.line}` : ""}
                </span>
                <span>{p.price != null ? `${p.price} ${me.household.currency}` : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {item.product_url && (
        <a href={item.product_url} target="_blank" rel="noreferrer" className="btn">
          Open the product page ↗
        </a>
      )}
      <ItemForm item={item} stores={stores} members={members} onClose={() => router.push("/shopping")} />
    </>
  );
}
