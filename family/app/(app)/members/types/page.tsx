import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { EntryType, Me } from "@/lib/types";
import { can } from "@/lib/types";
import { childName, possessive } from "@/lib/names";
import { EntryTypesAdmin } from "@/components/EntryTypesAdmin";
import { PageHeader } from "@/components/PageHeader";
import { meOnce } from "@/lib/server/me";

export const dynamic = "force-dynamic";

export default async function EntryTypesPage() {
  const supabase = await createClient();
  const { data: meData } = await meOnce();
  const me = meData as Me;
  if (!can(me, "members", "edit")) redirect("/members");
  const { data } = await supabase.from("care_entry_types").select("*").eq("module_id", "lana").order("module_id").order("sort");
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/members" title="Entry types" subtitle="What the logs can record, and when something is due again." />
      {!me.platform && (
        <p className="notice notice-accent">
          This is shared by every home on elnunu, so only the first home&apos;s admins change it. What you see here is what applies to yours.
        </p>
      )}
      <EntryTypesAdmin
        types={(data as EntryType[] | null) ?? []}
        modules={[
          { id: "lana", label: `${possessive(childName(me))} log` },
        ]}
      />
    </div>
  );
}
