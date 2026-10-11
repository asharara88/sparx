import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { CartRunRow, Me, RpcError, ShoppingData } from "@/lib/types";
import { can } from "@/lib/types";
import { CartBuilder } from "@/components/CartBuilder";

export const dynamic = "force-dynamic";

export default async function CartPage() {
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  if (!can(me, "shopping", "view")) redirect("/");
  const [{ data }, { data: runsData }] = await Promise.all([supabase.rpc("shopping_list"), supabase.rpc("cart_runs_list")]);
  const list = data as ShoppingData | RpcError;
  if (!list.ok) redirect("/shopping");
  const runs = ((runsData as { runs?: CartRunRow[] } | null)?.runs ?? []) as CartRunRow[];
  return <CartBuilder data={list} runs={runs} />;
}
