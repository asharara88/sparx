"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ShoppingRequest } from "@/lib/types";
import { fmtDateTime } from "@/lib/time";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Photo } from "./Photo";

export function RequestQueue({ pending, history, timezone }: { pending: ShoppingRequest[]; history: ShoppingRequest[]; timezone: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});

  async function review(r: ShoppingRequest, approve: boolean) {
    setBusy(r.id);
    const { data } = await supabaseBrowser().rpc("shopping_request_review", {
      p_id: r.id,
      p_approve: approve,
      p_item_name: names[r.id] || null,
    });
    setBusy(null);
    const res = data as { ok: boolean; message?: string } | null;
    if (!res?.ok) return alert(res?.message ?? "Could not save.");
    router.refresh();
  }

  return (
    <>
      {pending.length === 0 && <p className="muted">Nothing waiting. Lilly's taps and photos show up here.</p>}
      {pending.map((r) => (
        <section key={r.id} className="card flex flex-col gap-3">
          <div>
            <p className="text-lg font-bold">
              <span aria-hidden>{r.emoji ? `${r.emoji} ` : ""}</span>
              {r.item_name}
            </p>
            <p className="muted text-sm">
              {r.created_by_name} · {fmtDateTime(r.created_at, timezone)}
            </p>
            {r.note && <p className="mt-1">{r.note}</p>}
          </div>
          {r.photo_path && <Photo path={r.photo_path} alt="" className="h-56 w-full" />}
          <label className="flex flex-col gap-1">
            <span className="muted text-sm">Name on the list (change if the photo shows something else)</span>
            <input className="input" value={names[r.id] ?? r.item_name} onChange={(e) => setNames({ ...names, [r.id]: e.target.value })} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button className="btn btn-danger" onClick={() => review(r, false)} disabled={busy === r.id}>
              Not needed
            </button>
            <button className="btn btn-primary" onClick={() => review(r, true)} disabled={busy === r.id}>
              Add to list
            </button>
          </div>
        </section>
      ))}
      {history.length > 0 && (
        <section className="card">
          <h2 className="text-lg font-bold">Already handled</h2>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {history.map((r) => (
              <li key={r.id}>
                {r.status === "approved" ? "✅" : "⛔"} {r.item_name} · {r.created_by_name} · {fmtDateTime(r.created_at, timezone)}
                {r.reviewed_by_name ? ` · by ${r.reviewed_by_name}` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
