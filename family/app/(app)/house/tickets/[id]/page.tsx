import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Asset, Contractor, Me, RpcError, TicketDetail as TicketDetailData } from "@/lib/types";
import { can } from "@/lib/types";
import { TicketDetail } from "@/components/TicketDetail";

export const dynamic = "force-dynamic";

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  if (!can(me, "maintenance", "view")) redirect("/");
  const [{ data }, { data: a }, { data: c }] = await Promise.all([
    supabase.rpc("ticket_get", { p_id: id }),
    supabase.rpc("assets_list"),
    supabase.rpc("contractors_list"),
  ]);
  const detail = data as TicketDetailData | RpcError | null;
  if (!detail || !detail.ok || !detail.ticket) redirect("/house");
  return (
    <TicketDetail
      data={detail}
      assets={((a as { assets?: Asset[] })?.assets ?? []) as Asset[]}
      contractors={((c as { contractors?: Contractor[] })?.contractors ?? []) as Contractor[]}
      timezone={me.household.timezone}
    />
  );
}
