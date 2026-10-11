import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Me, ReceiptDetail, RpcError, ShoppingData } from "@/lib/types";
import { can } from "@/lib/types";
import { ReceiptReview } from "@/components/ReceiptReview";

export const dynamic = "force-dynamic";

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  if (!can(me, "shopping", "view")) redirect("/");
  const [{ data }, { data: listData }] = await Promise.all([supabase.rpc("receipt_get", { p_id: id }), supabase.rpc("shopping_list")]);
  const detail = data as ReceiptDetail | RpcError | null;
  const list = listData as ShoppingData | RpcError | null;
  if (!detail || !detail.ok || !detail.receipt || !list || !list.ok) redirect("/shopping/receipts");
  return <ReceiptReview detail={detail} items={list.items} stores={list.stores} />;
}
