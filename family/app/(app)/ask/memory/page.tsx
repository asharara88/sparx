import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Me, MemoryData, RpcError } from "@/lib/types";
import { can } from "@/lib/types";
import { MemoryList } from "@/components/MemoryList";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function MemoryPage() {
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  if (!can(me, "assistant", "view")) redirect("/");
  const { data } = await supabase.rpc("memory_list");
  const mem = data as MemoryData | RpcError | null;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/ask" title="What the helper remembers" subtitle="Short facts the family told it. They go into every answer, for everyone." />
      <MemoryList items={mem && mem.ok ? mem.items : []} timezone={me.household.timezone} />
    </div>
  );
}
