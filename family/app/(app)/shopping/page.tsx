import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Me, RpcError, ShoppingData } from "@/lib/types";
import { can } from "@/lib/types";
import { ShoppingList } from "@/components/ShoppingList";

export const dynamic = "force-dynamic";

export default async function ShoppingPage() {
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  if (!can(me, "shopping", "view")) redirect(can(me, "shopping_requests", "add") ? "/send" : "/");
  const [{ data }, { data: members }] = await Promise.all([
    supabase.rpc("shopping_list"),
    supabase.from("members").select("id, display_name").eq("is_active", true).order("display_name"),
  ]);
  const list = data as ShoppingData | RpcError;
  if (!list.ok) redirect("/");
  return (
    <ShoppingList
      data={list}
      members={((members as { id: string; display_name: string }[]) ?? []).map((m) => ({ id: m.id, name: m.display_name }))}
    />
  );
}
