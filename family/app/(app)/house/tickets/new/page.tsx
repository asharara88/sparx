import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Asset, Me } from "@/lib/types";
import { can } from "@/lib/types";
import { TicketForm } from "@/components/TicketForm";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

export default async function NewTicketPage() {
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  if (!can(me, "maintenance", "add")) redirect("/");
  const { data } = await supabase.rpc("assets_list");
  const assets = ((data as { assets?: Asset[] })?.assets ?? []) as Asset[];
  return (
    <div className="flex flex-col gap-4">
      <header className="page-header flex items-center gap-2">
        <Link href="/house" className="icon-btn" aria-label="Back">
          <Icon name="back" size={24} />
        </Link>
      </header>
      <TicketForm assets={assets} />
    </div>
  );
}
