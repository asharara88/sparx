import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Me, Purchase, RpcError, ShoppingData } from "@/lib/types";
import { can } from "@/lib/types";
import { ItemEdit } from "@/components/ItemEdit";

export const dynamic = "force-dynamic";

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  if (!can(me, "shopping", "view")) redirect("/");
  const [{ data }, { data: members }, { data: purchData }] = await Promise.all([
    supabase.rpc("shopping_list"),
    supabase.from("members").select("id, display_name").eq("is_active", true).order("display_name"),
    supabase.rpc("purchases_for_item", { p_item_id: id }),
  ]);
  const purchases = ((purchData as { purchases?: Purchase[] } | null)?.purchases ?? []) as Purchase[];
  const list = data as ShoppingData | RpcError;
  if (!list.ok) redirect("/shopping");
  const item = list.items.find((i) => i.id === id);
  if (!item) redirect("/shopping");
  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-3 pt-2">
        <Link href="/shopping" className="btn" aria-label="Back">
          ‹
        </Link>
        <h1 className="text-2xl font-bold">Item</h1>
      </header>
      <ItemEdit item={item} stores={list.stores} purchases={purchases} members={((members as { id: string; display_name: string }[]) ?? []).map((m) => ({ id: m.id, name: m.display_name }))} />
    </div>
  );
}
