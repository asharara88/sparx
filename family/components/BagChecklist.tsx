"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { BagItem } from "@/lib/types";
import { can } from "@/lib/types";
import { useMe } from "@/lib/me-context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Icon } from "@/components/Icon";

/** What goes in the bag: tick as you pack, "Empty the bag" for the next outing. Admins edit the list. */
export function BagChecklist({ items }: { items: BagItem[] }) {
  const me = useMe();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const canTick = can(me, "lana", "add");
  const canEdit = can(me, "lana", "edit") && can(me, "members", "edit");
  const live = items.filter((i) => i.is_active);
  const packed = live.filter((i) => i.checked).length;
  async function call(fn: string, args: Record<string, unknown>, key: string) {
    setBusy(key);
    setMsg(null);
    const { data, error } = await supabaseBrowser().rpc(fn, args);
    setBusy(null);
    const res = data as { ok: boolean; message?: string } | null;
    if (error || !res?.ok) return setMsg(res?.message ?? error?.message ?? "Could not save.");
    router.refresh();
    return true;
  }
  return (
    <section className="card">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">The bag</h2>
        <span className="pill">
          {packed} / {live.length}
        </span>
      </div>
      <ul className="mt-2 flex flex-col">
        {live.map((i) => (
          <li key={i.id} className="row">
            <button type="button" className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${i.checked ? "bg-[var(--ok)] text-white" : "border border-[var(--line)] bg-[var(--card-2)]"}`} aria-pressed={i.checked} aria-label={i.label} disabled={!canTick || busy === i.id} onClick={() => call("bag_toggle", { p_id: i.id, p_checked: !i.checked }, i.id)}>
              {i.checked && <Icon name="check" size={18} />}
            </button>
            <span className={`grow ${i.checked ? "muted line-through" : ""}`}>{i.label}</span>
            {canEdit && (
              <button type="button" className="icon-btn m-0 text-[var(--muted)]" aria-label="Remove from the list" disabled={busy === i.id} onClick={() => call("bag_save", { p_id: i.id, p_label: i.label, p_sort: i.sort, p_is_active: false }, i.id)}>
                <Icon name="x" size={16} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <form
          className="mt-2 flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (adding.trim() && (await call("bag_save", { p_id: null, p_label: adding.trim(), p_sort: 100, p_is_active: true }, "add"))) setAdding("");
          }}
        >
          <input className="input" value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Add to the list" maxLength={80} />
          <button type="submit" className="btn shrink-0" disabled={!adding.trim() || busy === "add"}>
            Add
          </button>
        </form>
      )}
      {canTick && packed > 0 && (
        <button type="button" className="btn mt-3 w-full" disabled={busy === "reset"} onClick={() => call("bag_reset", {}, "reset")}>
          Empty the bag for next time
        </button>
      )}
      {msg && <p className="mt-2 text-sm text-[var(--danger)]">{msg}</p>}
    </section>
  );
}
