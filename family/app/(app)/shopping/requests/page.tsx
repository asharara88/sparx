import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Me, ShoppingRequest } from "@/lib/types";
import { can } from "@/lib/types";
import { RequestQueue } from "@/components/RequestQueue";

export const dynamic = "force-dynamic";

export default async function RequestsPage() {
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  if (!can(me, "shopping_review", "view")) redirect("/");
  const [{ data: pending }, { data: recent }] = await Promise.all([
    supabase.rpc("shopping_requests_list", { p_status: "pending" }),
    supabase.rpc("shopping_requests_list", { p_status: null }),
  ]);
  const p = ((pending as { requests?: ShoppingRequest[] })?.requests ?? []) as ShoppingRequest[];
  const all = ((recent as { requests?: ShoppingRequest[] })?.requests ?? []) as ShoppingRequest[];
  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-3 pt-2">
        <Link href="/shopping" className="btn" aria-label="Back">
          ‹
        </Link>
        <h1 className="text-2xl font-bold">Running-low requests</h1>
      </header>
      <RequestQueue pending={p} history={all.filter((r) => r.status !== "pending").slice(0, 20)} timezone={me.household.timezone} />
    </div>
  );
}
