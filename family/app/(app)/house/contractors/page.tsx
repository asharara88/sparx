import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Contractor, Me } from "@/lib/types";
import { can } from "@/lib/types";
import { ContractorBook } from "@/components/ContractorBook";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function ContractorsPage() {
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  if (!can(me, "maintenance", "view")) redirect("/");
  const { data } = await supabase.rpc("contractors_list");
  const contractors = ((data as { contractors?: Contractor[] })?.contractors ?? []) as Contractor[];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/house" title="Who to call" />
      <ContractorBook contractors={contractors} />
    </div>
  );
}
