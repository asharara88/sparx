import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Me } from "@/lib/types";
import { can } from "@/lib/types";
import { HouseholdForm } from "@/components/HouseholdForm";
import { DeleteHome } from "@/components/DeleteHome";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

/** The home's own settings (name, milk goal, notes for the helper) and deleting it: rarely needed, so off the Members list. */
export default async function HomeSettingsPage() {
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me | null;
  if (!me?.ok || !can(me, "members", "edit")) redirect("/");
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/members" title="Home settings" />
      <HouseholdForm household={me.household} />
      {me.role.id === "admin" && !me.preview && <DeleteHome household={me.household} platform={me.platform === true} />}
    </div>
  );
}
