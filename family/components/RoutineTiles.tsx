"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Routine } from "@/lib/types";
import { can } from "@/lib/types";
import { useMe } from "@/lib/me-context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Icon } from "@/components/Icon";

function dueText(r: Routine): { text: string; tone: "ok" | "warn" | "danger" | "muted" } {
  if (r.days_left == null) return { text: "Not done yet", tone: "muted" };
  if (r.days_left < 0) return { text: `${-r.days_left} ${-r.days_left === 1 ? "day" : "days"} overdue`, tone: "danger" };
  if (r.days_left === 0) return { text: "Due today", tone: "warn" };
  if (r.days_left === 1) return { text: "Due tomorrow", tone: "ok" };
  return { text: `In ${r.days_left} days`, tone: "ok" };
}

/** "Every N days" tiles: litter change, brushing, flea drops. Tap Done; the linked entry is logged. */
export function RoutineTiles({ routines, module, editHref }: { routines: Routine[]; module: string; editHref?: string }) {
  const me = useMe();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const canDo = can(me, module, "add");
  async function done(id: string) {
    setBusy(id);
    setMsg(null);
    const { data, error } = await supabaseBrowser().rpc("routine_done", { p_id: id });
    setBusy(null);
    const res = data as { ok: boolean; message?: string } | null;
    if (error || !res?.ok) return setMsg(res?.message ?? error?.message ?? "Could not save.");
    router.refresh();
  }
  if (routines.length === 0 && !editHref) return null;
  return (
    <section className="flex flex-col gap-2" aria-labelledby="routines-h">
      <div className="flex items-center justify-between px-1">
        <h2 id="routines-h" className="section-title">
          Routines
        </h2>
        {editHref && can(me, "members", "edit") && (
          <Link href={editHref} className="text-sm font-semibold text-[var(--accent)]">
            Edit
          </Link>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {routines.map((r) => {
          const d = dueText(r);
          return (
            <div key={r.id} className="tile justify-between">
              <span>
                <span className="block font-semibold">{r.label}</span>
                <span className={`pill pill-${d.tone === "muted" ? "" : d.tone} mt-1`}>{d.text}</span>
                <span className="muted mt-1 block text-xs">every {r.every_days} {r.every_days === 1 ? "day" : "days"}</span>
              </span>
              {canDo && (
                <button type="button" className="btn btn-secondary w-full" style={{ minHeight: 40 }} disabled={busy === r.id} onClick={() => done(r.id)}>
                  <Icon name="check" size={16} /> Done
                </button>
              )}
            </div>
          );
        })}
      </div>
      {msg && <p className="text-sm text-[var(--danger)]">{msg}</p>}
    </section>
  );
}
