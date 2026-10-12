"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DueItem, HomeSummary } from "@/lib/types";
import { can } from "@/lib/types";
import { useMe } from "@/lib/me-context";
import { ago, fmtDate, fmtTime } from "@/lib/time";
import { supabaseBrowser } from "@/lib/supabase/client";
import { newClientId } from "@/lib/offline";

/** Fanta: fed / litter in one tap, what is due, the profile card. On the home screen (compact) just the one-line status, anything overdue, and the link. */
export function FantaCard({ summary, due, compact = false }: { summary: HomeSummary; due: DueItem[]; compact?: boolean }) {
  const me = useMe();
  const router = useRouter();
  const { subject, types, last, timezone } = summary;
  const canAdd = can(me, "fanta", "add");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const now = new Date();
  const food = types.find((t) => t.key === "food");
  const litter = types.find((t) => t.key === "litter");
  const treat = types.find((t) => t.key === "treat");
  const lastFood = last["fanta.food"];
  const lastLitter = last["fanta.litter"];
  const lastWeight = last["fanta.weight"];
  const foods = ((food?.fields.find((f) => f.key === "food")?.options ?? ["½ wet pouch", "Dry food"]) as string[]).filter((o) => o !== "Other");
  const mine = due.filter((d) => d.subject_id === subject.id);
  const overdue = mine.filter((d) => d.overdue);

  async function log(typeId: string | undefined, payload: Record<string, unknown>, label: string) {
    if (!typeId) return;
    setBusy(true);
    setMsg(null);
    const { data, error } = await supabaseBrowser().rpc("care_entry_log", {
      p_subject_id: subject.id,
      p_type_id: typeId,
      p_occurred_at: new Date().toISOString(),
      p_ended_at: null,
      p_payload: payload,
      p_note: null,
      p_client_id: newClientId(),
    });
    setBusy(false);
    const res = data as { ok: boolean; message?: string } | null;
    if (error || !res?.ok) return setMsg(res?.message ?? error?.message ?? "Could not save.");
    setMsg(label);
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-3" aria-labelledby="fanta-h">
      <div className="flex items-start justify-between gap-3">
        <h2 id="fanta-h" className="text-2xl font-bold">
          {subject.name}
        </h2>
        <Link href="/fanta/profile" className="btn">
          Profile card
        </Link>
      </div>

      {overdue.length > 0 && (
        <div className="notice notice-warn">
          {overdue.map((d) => (
            <p key={d.label + d.due_at} className="font-semibold">
              {d.icon} {d.label} · {d.kind === "treatment" ? `was due ${fmtDate(d.due_at, timezone)}` : `last ${ago(d.last_at!, now)}`}
            </p>
          ))}
        </div>
      )}

      <p className="muted text-sm">
        {lastFood ? `Fed ${ago(lastFood.occurred_at, now)} (${fmtTime(lastFood.occurred_at, timezone)}${lastFood.payload.food ? `, ${lastFood.payload.food}` : ""}${lastFood.payload.amount_g ? `, ${lastFood.payload.amount_g} g` : ""}${lastFood.by ? `, ${lastFood.by}` : ""})` : "Not fed yet today"}
        {lastLitter ? ` · litter ${ago(lastLitter.occurred_at, now)}` : ""}
        {lastWeight ? ` · ${lastWeight.payload.weight_kg} kg` : ""}
      </p>

      {canAdd && !compact && (
        <>
          <div className="card">
            <p className="font-semibold">
              Fed
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {foods.map((what) => (
                <button key={what} type="button" className="chip min-h-[56px] text-lg" disabled={busy} onClick={() => log(food?.id, { food: what }, `Fed: ${what}.`)}>
                  {what}
                </button>
              ))}
              <Link href="/fanta/log/food" className="chip min-h-[56px]">
                Other…
              </Link>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button type="button" className="btn min-h-[64px] text-lg" disabled={busy} onClick={() => log(litter?.id, { kind: "Scooped" }, "Litter scooped.")}>
              Scooped
            </button>
            <button type="button" className="btn min-h-[64px] text-lg" disabled={busy} onClick={() => log(litter?.id, { kind: "Full change" }, "Litter changed.")}>
              Full change
            </button>
            <button type="button" className="btn min-h-[64px] text-lg" disabled={busy} onClick={() => log(treat?.id, {}, "Treat given.")}>
              Treat
            </button>
            <Link href="/fanta/log/treatment" className="btn min-h-[64px] text-lg">
              Treatment
            </Link>
          </div>
        </>
      )}
      {msg && (
        <p role="status" className="muted text-sm">
          {msg}
        </p>
      )}

      {mine.filter((d) => !d.overdue).length > 0 && (
        <div className="card">
          <p className="font-semibold">Coming up</p>
          <ul className="mt-1 flex flex-col gap-1 text-sm">
            {mine
              .filter((d) => !d.overdue)
              .map((d) => (
                <li key={d.label + d.due_at}>
                  {d.icon} {d.label} · {d.kind === "treatment" ? fmtDate(d.due_at, timezone, { day: "numeric", month: "short" }) : `about ${fmtTime(d.due_at, timezone)}`}
                </li>
              ))}
          </ul>
        </div>
      )}

      {!compact && (
        <p className="muted text-sm">
          Other entries:{" "}
          {types
            .filter((t) => !["food", "litter", "treat", "treatment"].includes(t.key))
            .map((t, i) => (
              <span key={t.id}>
                {i > 0 ? " · " : ""}
                <Link href={`/fanta/log/${t.key}`} className="underline">
                  {t.icon} {t.label}
                </Link>
              </span>
            ))}
        </p>
      )}
      {compact && (
        <Link href="/fanta" className="text-sm font-semibold text-[var(--accent)]">
          Fanta's log ›
        </Link>
      )}
    </section>
  );
}
