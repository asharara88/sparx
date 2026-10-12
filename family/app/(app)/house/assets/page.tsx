import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Asset, Me } from "@/lib/types";
import { ASSET_CATEGORIES, can } from "@/lib/types";
import { Photo } from "@/components/Photo";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

export default async function AssetsPage() {
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  if (!can(me, "maintenance", "view")) redirect("/");
  const { data } = await supabase.rpc("assets_list");
  const assets = ((data as { assets?: Asset[] })?.assets ?? []) as Asset[];
  const rooms = [...new Set(assets.map((a) => a.location ?? "Elsewhere"))];
  return (
    <div className="flex flex-col gap-4">
      <header className="page-header flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Link href="/house" className="icon-btn" aria-label="Back">
          <Icon name="back" size={24} />
        </Link>
          <h1 className="page-title">Appliances</h1>
        </div>
        {can(me, "maintenance", "add") && (
          <Link href="/house/assets/new" className="btn btn-primary">
            <Icon name="plus" size={18} /> Add
          </Link>
        )}
      </header>
      {assets.length === 0 && (
        <p className="muted card">Nothing registered yet. Photograph each appliance's label once; the model and serial number are read off it.</p>
      )}
      {rooms.map((room) => (
        <section key={room} className="card">
          <h2 className="font-semibold">{room}</h2>
          <ul className="mt-2 flex flex-col divide-y divide-[var(--line)]">
            {assets
              .filter((a) => (a.location ?? "Elsewhere") === room)
              .map((a) => (
                <li key={a.id}>
                  <Link href={`/house/assets/${a.id}`} className="flex items-center gap-3 py-2">
                    {a.label_path ? <Photo path={a.label_path} alt="" className="h-12 w-12 shrink-0" /> : <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--card-2)] text-xl">{ASSET_CATEGORIES.find((c) => c.id === a.category)?.icon}</span>}
                    <span className="grow">
                      <span className="block font-semibold">{a.name}</span>
                      <span className="muted block text-sm">
                        {[a.brand, a.model].filter(Boolean).join(" ")}
                        {a.serial ? ` · S/N ${a.serial}` : ""}
                        {a.warranty_until ? ` · warranty to ${a.warranty_until}` : ""}
                        {a.open_tickets ? ` · ${a.open_tickets} open` : ""}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
