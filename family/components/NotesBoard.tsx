"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Note } from "@/lib/types";
import { can } from "@/lib/types";
import { useMe } from "@/lib/me-context";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ago } from "@/lib/time";
import { Icon } from "@/components/Icon";

/**
 * The notes board: short notes for the house ("the baby liked the pear", "plumber Thursday").
 * "Just for me" keeps a note private to its author (a grandmother's own log).
 * compact = the home-screen card: a few notes and a quick line to add one.
 */
export function NotesBoard({ notes, compact = false }: { notes: Note[]; compact?: boolean }) {
  const me = useMe();
  const router = useRouter();
  const [text, setText] = useState("");
  const [priv, setPriv] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const canAdd = can(me, "notes", "add");
  const admin = can(me, "members", "edit");
  const now = new Date();
  const shown = compact ? notes.slice(0, 3) : notes;

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
  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    if (await call("note_save", { p_id: null, p_body: text.trim(), p_is_private: priv, p_pinned: false }, "add")) {
      setText("");
      setPriv(false);
    }
  }

  return (
    <section className="card flex flex-col gap-3" aria-labelledby="notes-h">
      <div className="flex items-center justify-between">
        <h2 id="notes-h" className="text-lg font-semibold">
          Notes
        </h2>
        {compact && (
          <Link href="/notes" className="text-sm font-semibold text-[var(--accent)]">
            All notes ›
          </Link>
        )}
      </div>
      {canAdd && (
        <form onSubmit={add} className="flex flex-col gap-2">
          <div className="flex gap-2">
            <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a note for the house…" maxLength={2000} />
            <button type="submit" className="btn btn-primary shrink-0" disabled={busy === "add" || !text.trim()} aria-label="Add note">
              <Icon name="plus" size={20} />
            </button>
          </div>
          {text.trim() && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} className="h-5 w-5" style={{ minHeight: 0 }} />
              Just for me (nobody else sees it)
            </label>
          )}
        </form>
      )}
      {msg && <p className="text-sm text-[var(--danger)]">{msg}</p>}
      {shown.length === 0 ? (
        <p className="muted text-sm">No notes yet.</p>
      ) : (
        <ul className="flex flex-col">
          {shown.map((n) => (
            <li key={n.id} className="row items-start">
              <div className="min-w-0 grow">
                <p className="whitespace-pre-wrap">{n.body}</p>
                <p className="muted mt-0.5 text-xs">
                  {n.is_private ? "Just for me · " : n.author_name ? `${n.author_name} · ` : ""}
                  {ago(n.created_at, now)}
                  {n.pinned ? " · pinned" : ""}
                </p>
              </div>
              {(n.mine || admin) && !compact && (
                <div className="flex shrink-0 gap-1">
                  {admin && !n.is_private && (
                    <button type="button" className="icon-btn m-0" aria-label={n.pinned ? "Unpin" : "Pin"} disabled={busy === n.id} onClick={() => call("note_save", { p_id: n.id, p_body: n.body, p_is_private: n.is_private, p_pinned: !n.pinned }, n.id)}>
                      <Icon name="pin" size={18} className={n.pinned ? "text-[var(--accent)]" : "text-[var(--muted)]"} />
                    </button>
                  )}
                  <button type="button" className="icon-btn m-0 text-[var(--muted)]" aria-label="Remove" disabled={busy === n.id} onClick={() => confirm("Remove this note?") && call("note_remove", { p_id: n.id }, n.id)}>
                    <Icon name="x" size={18} />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
