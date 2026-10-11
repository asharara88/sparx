import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Asset, Me } from "@/lib/types";
import { can } from "@/lib/types";
import { AssetForm } from "@/components/AssetForm";
import { Attachments } from "@/components/Attachments";

export const dynamic = "force-dynamic";

export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  if (!can(me, "maintenance", "view")) redirect("/");
  const { data } = await supabase.rpc("assets_list");
  const asset = (((data as { assets?: Asset[] })?.assets ?? []) as Asset[]).find((a) => a.id === id);
  if (!asset) redirect("/house/assets");
  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-3 pt-2">
        <Link href="/house/assets" className="btn" aria-label="Back">
          ‹
        </Link>
        <Link href={`/house/tickets/new`} className="btn">
          Something wrong with it?
        </Link>
      </header>
      {can(me, "maintenance", "edit") ? (
        <AssetForm asset={asset} />
      ) : (
        <section className="card">
          <h1 className="text-2xl font-bold">{asset.name}</h1>
          <p>{[asset.brand, asset.model].filter(Boolean).join(" ")}</p>
          {asset.serial && <p>S/N {asset.serial}</p>}
          {asset.notes && <p className="mt-2">{asset.notes}</p>}
        </section>
      )}
      <Attachments module="maintenance" table="assets" entityId={asset.id} folder="assets" canAdd={can(me, "maintenance", "add")} title="Photos (label, receipt, manual)" />
    </div>
  );
}
