import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Me, MilkData, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { MilkStash } from "@/components/MilkStash";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function MilkPage() {
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  if (!can(me, "lana", "view")) redirect("/");
  const { data } = await supabase.rpc("milk_list");
  const milk = data as MilkData | RpcError;
  if (!milk.ok) redirect("/");
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/" title="Milk stash" subtitle="What is in the fridge and freezer, oldest first." />
      <MilkStash data={milk} timezone={me.household.timezone} />
    </div>
  );
}
