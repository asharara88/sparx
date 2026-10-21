import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Me, Module, Role } from "@/lib/types";
import { can } from "@/lib/types";
import { PermissionGrid } from "@/components/PermissionGrid";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function RolesPage() {
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  if (!can(me, "members", "edit")) redirect("/");
  const [{ data: roles }, { data: modules }, { data: perms }] = await Promise.all([
    supabase.from("roles").select("*").order("sort"),
    supabase.from("modules").select("*").order("sort"),
    supabase.from("permissions").select("role_id, module_id, action, allowed"),
  ]);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/members" title="Roles and permissions" />
      <p className="muted">Tick what each role may do. Changes apply at once, in the app and in the database.</p>
      {!me.platform && (
        <p className="notice notice-accent">
          This is shared by every home on elnunu, so only the first home&apos;s admins change it. What you see here is what applies to yours.
        </p>
      )}
      <PermissionGrid
        roles={roles as Role[]}
        modules={modules as Module[]}
        permissions={(perms as { role_id: string; module_id: string; action: string; allowed: boolean }[]) ?? []}
        myRole={me.role.id}
      />
    </div>
  );
}
