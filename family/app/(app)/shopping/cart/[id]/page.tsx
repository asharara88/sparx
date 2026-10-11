import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { CartRun, Me } from "@/lib/types";
import { can } from "@/lib/types";
import { CartRunView } from "@/components/CartRunView";

export const dynamic = "force-dynamic";

export default async function CartRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  if (!can(me, "shopping", "view")) redirect("/");
  const { data } = await supabase.rpc("cart_run_get", { p_id: id });
  const run = (data as { ok: boolean; run?: CartRun } | null)?.run;
  if (!run) redirect("/shopping/cart");
  return <CartRunView run={run} />;
}
