"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { MemoryItem } from "@/lib/types";
import { can } from "@/lib/types";
import { useMe } from "@/lib/me-context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtDate } from "@/lib/time";
import { childName } from "@/lib/names";
import { Icon } from "@/components/Icon";

/** What the helper has been told to remember. Anyone can add; whoever added it, or an admin, can remove. */
export function MemoryList({ items, timezone }: { items: MemoryItem[]; timezone: string }) {
  const me = useMe();
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const admin = can(me, "members", "edit");

  async function add() {
    const b = body.trim();
    if (b.length < 2) return;
    setBusy("add");
    setMsg(null);
    const { data, error } = await supabaseBrowser().rpc("memory_add", { p_body: b });
    const res = data as { ok: boolean; message?: string; duplicate?: boolean } | null;
    setBusy(null);
    if (error || !res?.ok) return setMsg(res?.message ?? error?.message ?? "Could not save.");
    setBody("");
    if (res.duplicate) setMsg("It already remembers that.");
    router.refresh();
  }
  async function remove(id: string) {
    setBusy(id);
    const { data } = await supabaseBrowser().rpc("memory_remove", { p_id: id });
    const res = data as { ok: boolean; message?: string } | null;
    setBusy(null);
    if (!res?.ok) return setMsg(res?.message ?? "Could not remove it.");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <form
        className="card flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <label className="font-semibold" htmlFor="mem">
          Tell the helper something to keep in mind
        </label>
        <textarea id="mem" className="input min-h-[72px]" maxLength={300} placeholder={`e.g. ${childName(me)} takes a bottle better when it is warm. Grandma likes a short answer.`} value={body} onChange={(e) => setBody(e.target.value)} />
        <button type="submit" className="btn btn-primary" disabled={body.trim().length < 2 || busy === "add"}>
          Remember this
        </button>
        <p className="muted text-xs">You can also say “remember that …” in Ask; it prepares the memory and you tap Confirm.</p>
      </form>
      <section className="card">
        <h2 className="font-semibold">It remembers {items.length === 0 ? "nothing yet" : `${items.length} ${items.length === 1 ? "thing" : "things"}`}</h2>
        <ul className="mt-1 flex flex-col">
          {items.map((m) => (
            <li key={m.id} className="row">
              <div className="min-w-0 grow">
                <p>{m.body}</p>
                <p className="muted text-xs">
                  {m.by ?? "Someone"} · {fmtDate(m.created_at, timezone, { day: "numeric", month: "short" })}
                </p>
              </div>
              {(m.mine || admin) && (
                <button type="button" className="icon-btn m-0 text-[var(--muted)]" style={{ width: 40, height: 40, minHeight: 40 }} aria-label="Forget this" disabled={busy === m.id} onClick={() => void remove(m.id)}>
                  <Icon name="x" size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
        {msg && <p className="mt-2 text-sm text-[var(--danger)]">{msg}</p>}
      </section>
    </div>
  );
}
