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

/**
 * What the helper remembers. Three parts, each only when it has something:
 * what the helper noticed in chats and nobody has confirmed (keep or drop,
 * one tap each); a line to tell it something, with who it is about; and the
 * list, where the author or an admin can change or forget a memory.
 */
export interface AboutOption {
  key: string;
  label: string;
  kind: "home" | "child" | "person";
  id: string | null;
}

type Res = { ok: boolean; message?: string; duplicate?: boolean; kept_suggestion?: boolean } | null;

export function MemoryList({ items, timezone, about }: { items: MemoryItem[]; timezone: string; about: AboutOption[] }) {
  const me = useMe();
  const router = useRouter();
  const [body, setBody] = useState("");
  const [aboutKey, setAboutKey] = useState(about[0]?.key ?? "home");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; body: string; until: string } | null>(null);
  const admin = can(me, "members", "edit");
  const suggested = items.filter((m) => m.status === "suggested");
  const kept = items.filter((m) => m.status !== "suggested");

  async function call(name: string, args: Record<string, unknown>, key: string, fail: string): Promise<boolean> {
    setBusy(key);
    setMsg(null);
    const { data, error } = await supabaseBrowser().rpc(name, args);
    const res = data as Res;
    setBusy(null);
    if (error || !res?.ok) {
      setMsg(res?.message ?? error?.message ?? fail);
      return false;
    }
    if (res.duplicate) setMsg("It already remembers that.");
    router.refresh();
    return true;
  }
  async function add() {
    const b = body.trim();
    if (b.length < 2) return;
    const a = about.find((o) => o.key === aboutKey) ?? about[0];
    const ok = await call("memory_add", { p_body: b, p_kind: a?.kind ?? "home", p_about_member_id: a?.kind === "person" ? a.id : null, p_subject_id: a?.kind === "child" ? a.id : null, p_expires_at: null }, "add", "Could not save.");
    if (ok) setBody("");
  }
  async function save() {
    if (!editing) return;
    const until = editing.until ? new Date(`${editing.until}T23:59:00`).toISOString() : null;
    const ok = await call("memory_update", { p_id: editing.id, p_body: editing.body.trim(), p_expires_at: until }, editing.id, "Could not change it.");
    if (ok) setEditing(null);
  }
  const tag = (m: MemoryItem) => (m.kind === "child" ? m.subject?.name : m.kind === "person" ? m.about?.name : null) ?? "Home";

  return (
    <div className="flex flex-col gap-3">
      {suggested.length > 0 && (
        <section className="card">
          <h2 className="font-semibold">The helper noticed</h2>
          <p className="muted text-xs">From your chats. Keep what is true; drop the rest.</p>
          <ul className="mt-1 flex flex-col">
            {suggested.map((m) => (
              <li key={m.id} className="row">
                <div className="min-w-0 grow">
                  <p>{m.body}</p>
                  <p className="muted text-xs">About {tag(m).toLowerCase() === "home" ? "the home" : tag(m)}</p>
                </div>
                <button type="button" className="btn btn-secondary m-0 shrink-0" disabled={busy === m.id} onClick={() => void call("memory_keep", { p_id: m.id }, m.id, "Could not keep it.")}>
                  Keep
                </button>
                <button type="button" className="icon-btn m-0 text-[var(--muted)]" style={{ width: 44, height: 44, minHeight: 44 }} aria-label="Drop this" disabled={busy === m.id} onClick={() => void call("memory_remove", { p_id: m.id }, m.id, "Could not drop it.")}>
                  <Icon name="x" size={16} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
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
        <div className="flex items-center gap-2">
          <label className="muted shrink-0 text-sm" htmlFor="mem-about">
            About
          </label>
          <select id="mem-about" className="input min-w-0 grow" value={aboutKey} onChange={(e) => setAboutKey(e.target.value)}>
            {about.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn-primary m-0 shrink-0" disabled={body.trim().length < 2 || busy === "add"}>
            Remember
          </button>
        </div>
        <p className="muted text-xs">You can also say “remember that …” in Ask; it prepares the memory and you tap Confirm.</p>
      </form>
      <section className="card">
        <h2 className="font-semibold">It remembers {kept.length === 0 ? "nothing yet" : `${kept.length} ${kept.length === 1 ? "thing" : "things"}`}</h2>
        <ul className="mt-1 flex flex-col">
          {kept.map((m) =>
            editing?.id === m.id ? (
              <li key={m.id} className="row flex-col items-stretch gap-2">
                <textarea className="input min-h-[72px]" maxLength={300} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} aria-label="The memory" />
                <div className="flex items-center gap-2">
                  <label className="muted shrink-0 text-sm" htmlFor="mem-until">
                    Forget on
                  </label>
                  <input id="mem-until" type="date" className="input min-w-0 grow" value={editing.until} onChange={(e) => setEditing({ ...editing, until: e.target.value })} />
                  <button type="button" className="btn btn-ghost m-0 shrink-0" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                  <button type="button" className="btn btn-primary m-0 shrink-0" disabled={editing.body.trim().length < 2 || busy === m.id} onClick={() => void save()}>
                    Save
                  </button>
                </div>
              </li>
            ) : (
              <li key={m.id} className="row">
                <div className="min-w-0 grow">
                  <p>{m.body}</p>
                  <p className="muted text-xs">
                    {tag(m)} · {m.by ?? "The helper"} · {fmtDate(m.created_at, timezone, { day: "numeric", month: "short" })}
                    {m.expires_at ? ` · until ${fmtDate(m.expires_at, timezone, { day: "numeric", month: "short" })}` : ""}
                  </p>
                </div>
                {(m.mine || admin) && (
                  <>
                    <button type="button" className="icon-btn m-0 text-[var(--muted)]" style={{ width: 44, height: 44, minHeight: 44 }} aria-label="Change this" disabled={busy === m.id} onClick={() => setEditing({ id: m.id, body: m.body, until: m.expires_at ? m.expires_at.slice(0, 10) : "" })}>
                      <Icon name="note" size={16} />
                    </button>
                    <button type="button" className="icon-btn m-0 text-[var(--muted)]" style={{ width: 44, height: 44, minHeight: 44 }} aria-label="Forget this" disabled={busy === m.id} onClick={() => void call("memory_remove", { p_id: m.id }, m.id, "Could not remove it.")}>
                      <Icon name="x" size={16} />
                    </button>
                  </>
                )}
              </li>
            ),
          )}
        </ul>
        {msg && <p className="mt-2 text-sm text-[var(--danger)]">{msg}</p>}
      </section>
    </div>
  );
}
