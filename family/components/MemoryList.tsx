"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { MemoryItem } from "@/lib/types";
import { can } from "@/lib/types";
import { useMe } from "@/lib/me-context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtDate } from "@/lib/time";
import { childName } from "@/lib/names";
import { Sheet } from "@/components/Sheet";

/**
 * What the helper remembers. Three parts, each only when it has something:
 * what the helper noticed in chats and nobody has confirmed (keep or drop,
 * one tap each); a line to tell it something, with who it is about; and the
 * list, where the author or an admin taps a memory to change or forget it in a sheet.
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
  // A kept memory opened in its sheet: change the words or the day to forget it, or forget it now.
  const [editing, setEditing] = useState<{ id: string; body: string; until: string } | null>(null);
  const [armed, setArmed] = useState(false);
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
  function openSheet(m: MemoryItem) {
    setMsg(null);
    setArmed(false);
    setEditing({ id: m.id, body: m.body, until: m.expires_at ? m.expires_at.slice(0, 10) : "" });
  }
  function close() {
    setEditing(null);
    setArmed(false);
    setMsg(null);
  }
  async function save() {
    if (!editing) return;
    const until = editing.until ? new Date(`${editing.until}T23:59:00`).toISOString() : null;
    const ok = await call("memory_update", { p_id: editing.id, p_body: editing.body.trim(), p_expires_at: until }, editing.id, "Could not change it.");
    if (ok) close();
  }
  async function forget() {
    if (!editing) return;
    // Destroying is a word and a second tap, never a pop-up (DESIGN.md, rule 8).
    if (!armed) return setArmed(true);
    if (await call("memory_remove", { p_id: editing.id }, editing.id, "Could not remove it.")) close();
  }
  const tag = (m: MemoryItem) => (m.kind === "child" ? m.subject?.name : m.kind === "person" ? m.about?.name : null) ?? "Home";

  return (
    <div className="flex flex-col gap-3">
      {suggested.length > 0 && (
        <section className="flex flex-col gap-2" aria-labelledby="mem-noticed">
          <h2 id="mem-noticed" className="section-title">
            The helper noticed
          </h2>
          <p className="muted px-1 text-sm">From your chats. Keep what is true; drop the rest.</p>
          <ul className="card flex flex-col p-0">
            {suggested.map((m) => (
              // The words take the row's whole width and Keep / Drop sit under them: beside them,
              // the two buttons left a 95 px column at 320 px and a memory ran to seven lines.
              <li key={m.id} className="row flex-col gap-2 px-4">
                <div className="min-w-0">
                  <p>{m.body}</p>
                  <p className="muted text-sm">About {tag(m).toLowerCase() === "home" ? "the home" : tag(m)}</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" className="btn btn-secondary m-0 px-4" disabled={busy === m.id} onClick={() => void call("memory_keep", { p_id: m.id }, m.id, "Could not keep it.")}>
                    Keep
                  </button>
                  <button type="button" className="btn btn-ghost m-0 min-h-[44px] px-3" disabled={busy === m.id} onClick={() => void call("memory_remove", { p_id: m.id }, m.id, "Could not drop it.")}>
                    Drop
                  </button>
                </div>
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
        <textarea id="mem" className="input min-h-[72px]" maxLength={300} placeholder={`e.g. ${childName(me)} likes the bottle warm.`} value={body} onChange={(e) => setBody(e.target.value)} />
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
      </form>
      {msg && !editing && (
        <p role="alert" className="px-1 text-sm text-[var(--danger)]">
          {msg}
        </p>
      )}
      {kept.length === 0 ? (
        <p className="muted px-1">Nothing kept yet.</p>
      ) : (
        <section className="flex flex-col gap-2" aria-labelledby="mem-kept">
          <h2 id="mem-kept" className="section-title">
            It remembers {kept.length} {kept.length === 1 ? "thing" : "things"}
          </h2>
          <ul className="card flex flex-col p-0">
            {kept.map((m) => {
              const words = (
                <>
                  <span className="block">{m.body}</span>
                  <span className="muted block text-sm">
                    {tag(m)} · {m.by ?? "The helper"} · {fmtDate(m.created_at, timezone, { day: "numeric", month: "short" })}
                    {m.expires_at ? ` · until ${fmtDate(m.expires_at, timezone, { day: "numeric", month: "short" })}` : ""}
                  </span>
                </>
              );
              return (
                <li key={m.id} className="row px-4">
                  {m.mine || admin ? (
                    <button type="button" className="row-link block w-full min-w-0 text-left" onClick={() => openSheet(m)} aria-haspopup="dialog">
                      {words}
                    </button>
                  ) : (
                    <div className="min-w-0 grow">{words}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {editing && (
        <Sheet title="What it remembers" onClose={close}>
          <textarea className="input min-h-[96px]" maxLength={300} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} aria-label="The memory" />
          <div className="flex items-center gap-2">
            <label className="muted shrink-0 text-sm" htmlFor="mem-until">
              Forget on
            </label>
            <input id="mem-until" type="date" className="input min-w-0 grow" value={editing.until} onChange={(e) => setEditing({ ...editing, until: e.target.value })} />
          </div>
          {msg && (
            <p role="alert" className="text-sm text-[var(--danger)]">
              {msg}
            </p>
          )}
          <button type="button" className="btn btn-primary btn-lg w-full" disabled={editing.body.trim().length < 2 || busy === editing.id} onClick={() => void save()}>
            Save
          </button>
          <button type="button" className="btn btn-danger w-full" disabled={busy === editing.id} onClick={() => void forget()}>
            {armed ? "Tap again to forget" : "Forget this"}
          </button>
          <button type="button" className="btn w-full" onClick={close}>
            Cancel
          </button>
        </Sheet>
      )}
    </div>
  );
}
