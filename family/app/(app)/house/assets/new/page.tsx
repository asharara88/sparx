import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Me } from "@/lib/types";
import { can } from "@/lib/types";
import { AssetForm } from "@/components/AssetForm";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

export default async function NewAssetPage() {
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  if (!can(meData as Me, "maintenance", "add")) redirect("/");
  return (
    <div className="flex flex-col gap-4">
      <header className="page-header flex items-center gap-2">
        <Link href="/house/assets" className="icon-btn" aria-label="Back">
          <Icon name="back" size={24} />
        </Link>
      </header>
      <AssetForm asset={null} />
    </div>
  );
}
