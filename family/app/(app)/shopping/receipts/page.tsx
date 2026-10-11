import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Me, ReceiptRow } from "@/lib/types";
import { can } from "@/lib/types";
import { fmtDate } from "@/lib/time";
import { ReceiptCapture } from "@/components/ReceiptCapture";

export const dynamic = "force-dynamic";

export default async function ReceiptsPage() {
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  if (!can(me, "shopping", "view")) redirect("/");
  const { data } = await supabase.rpc("receipts_list");
  const receipts = ((data as { receipts?: ReceiptRow[] } | null)?.receipts ?? []) as ReceiptRow[];
  const tz = me.household.timezone;
  const label = (s: ReceiptRow["status"]) => (s === "applied" ? "✓ applied" : s === "read" ? "to check" : s === "new" ? "not read" : s);
  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-3 pt-2">
        <Link href="/shopping" className="btn" aria-label="Back">
          ‹
        </Link>
        <h1 className="text-2xl font-bold">Receipts</h1>
      </header>
      {can(me, "shopping", "add") && <ReceiptCapture />}
      <section className="card">
        <h2 className="text-lg font-bold">Earlier receipts</h2>
        {receipts.length === 0 && <p className="muted mt-1">None yet.</p>}
        <ul className="mt-2 flex flex-col gap-2">
          {receipts.map((r) => (
            <li key={r.id}>
              <Link href={`/shopping/receipts/${r.id}`} className="flex justify-between gap-2">
                <span>
                  <b>{r.store ?? "Shop?"}</b> · {r.bought_on ?? fmtDate(r.created_at, tz)}
                  {r.total != null ? ` · ${r.total} ${r.currency ?? me.household.currency}` : ""}
                </span>
                <span className={r.status === "read" && r.unmatched > 0 ? "font-semibold text-amber-800" : "muted"}>
                  {r.status === "read" && r.unmatched > 0 ? `${r.unmatched} to check` : label(r.status)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
