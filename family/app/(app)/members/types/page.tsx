import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { EntryType, Me } from "@/lib/types";
import { can } from "@/lib/types";
import { EntryTypesAdmin } from "@/components/EntryTypesAdmin";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function EntryTypesPage() {
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  if (!can(me, "members", "edit")) redirect("/members");
  const { data } = await supabase.from("care_entry_types").select("*").in("module_id", ["lana", "fanta"]).order("module_id").order("sort");
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/members" title="Entry types" subtitle="What the logs can record, and when something is due again." />
      <EntryTypesAdmin
        types={(data as EntryType[] | null) ?? []}
        modules={[
          { id: "lana", label: "Lana's log" },
          { id: "fanta", label: "Fanta's log" },
        ]}
      />
    </div>
  );
}
