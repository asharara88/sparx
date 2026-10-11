import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { HubEntity, Me } from "@/lib/types";
import { can } from "@/lib/types";
import { HubSettings } from "@/components/HubSettings";

export const dynamic = "force-dynamic";

/** Admin: which Home Assistant entities the house shows. */
export default async function HubPage() {
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  if (!can(me, "members", "edit")) redirect("/house");
  const { data } = await supabase.from("hub_entities").select("*").order("sort").order("label");
  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-3 pt-2">
        <Link href="/house" className="btn" aria-label="Back">
          ‹
        </Link>
        <h1 className="text-2xl font-bold">📡 The hub</h1>
      </header>
      <HubSettings configured={((data as HubEntity[] | null) ?? []).filter((e) => e.is_active)} />
    </div>
  );
}
