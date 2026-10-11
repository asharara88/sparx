import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Me, RpcError, Ticket } from "@/lib/types";
import { TICKET_STATUS, can } from "@/lib/types";
import { ago } from "@/lib/time";
import { Photo } from "@/components/Photo";
import { HubCard } from "@/components/HubCard";

export const dynamic = "force-dynamic";

/** The house: what needs fixing, the appliances, who to call. */
export default async function HousePage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me;
  if (!can(me, "maintenance", "view")) redirect("/");
  const { all } = await searchParams;
  const { data } = await supabase.rpc("tickets_list", { p_status: all ? null : "open" });
  const res = data as { ok: true; costs_visible: boolean; tickets: Ticket[] } | RpcError;
  const tickets = res.ok ? res.tickets : [];
  const now = new Date();
  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-2 pt-2">
        <h1 className="text-2xl font-bold">🏠 The house</h1>
        <Link href="/house/tickets/new" className="btn btn-primary">
          + Something to fix
        </Link>
      </header>
      <div className="grid grid-cols-2 gap-3">
        <Link href="/house/assets" className="btn">
          🔌 Appliances
        </Link>
        <Link href="/house/contractors" className="btn">
          📞 Who to call
        </Link>
      </div>
      <HubCard />
      <section className="card">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xl font-semibold">{all ? "All tickets" : "Open tickets"}</h2>
          <Link href={all ? "/house" : "/house?all=1"} className="text-sm font-semibold text-[var(--accent)]">
            {all ? "Open only" : "Show done"}
          </Link>
        </div>
        {tickets.length === 0 ? (
          <p className="muted mt-2">Nothing to fix. 🎉</p>
        ) : (
          <ul className="mt-2 flex flex-col divide-y divide-[var(--line)]">
            {tickets.map((t) => {
              const s = TICKET_STATUS.find((x) => x.id === t.status)!;
              return (
                <li key={t.id}>
                  <Link href={`/house/tickets/${t.id}`} className="flex items-center gap-3 py-3">
                    {t.photo_path ? <Photo path={t.photo_path} alt="" className="h-14 w-14 shrink-0" /> : <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-2xl">{s.icon}</span>}
                    <span className="grow">
                      <span className="block font-semibold">
                        {t.priority === "urgent" ? "🔥 " : ""}
                        {t.title}
                      </span>
                      <span className="muted block text-sm">
                        {s.label}
                        {t.location ? ` · ${t.location}` : ""}
                        {t.contractor_name ? ` · ${t.contractor_name}` : ""}
                        {` · ${ago(t.updated_at, now)}`}
                        {res.ok && res.costs_visible && t.cost_total ? ` · ${t.cost_total} ${me.household.currency}` : ""}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
