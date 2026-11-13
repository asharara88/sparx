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
import { Sheet } from "@/components/Sheet";

/**
 * The notes board: short notes for the house ("the baby liked the pear", "plumber Thursday").
 * "Just for me" keeps a note private to its author (a grandmother's own log).
 * compact = the home-screen card: a few notes and a quick line to add one.
 * On the full board a note its author (or an admin) may change opens a sheet of its actions:
 * pin it to the top, or delete it with a second tap (DESIGN.md, rule 8: a word, never a lone ×).
 */
export function NotesBoard({ notes, compact = false, bare = false }: { notes: Note[]; compact?: boolean; bare?: boolean }) {
  const me = useMe();
  const router = useRouter();
  const [text, setText] = useState("");
  const [priv, setPriv] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState<Note | null>(null);
  const [armed, setArmed] = useState(false);
  const canAdd = can(me, "notes", "add");
  const admin = can(me, "members", "edit");
  const now = new Date();
  const shown = compact ? notes.slice(0, 3) : notes;
  // The notes screen itself: the add line and the list as two white cards, rows edge to edge.
  const full = !compact && !bare;

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
  function show(n: Note) {
    setMsg(null);
    setArmed(false);
    setOpen(n);
  }
  function close() {
    setOpen(null);
    setArmed(false);
    setMsg(null);
  }
  async function pin(n: Note) {
    if (await call("note_save", { p_id: n.id, p_body: n.body, p_is_private: n.is_private, p_pinned: !n.pinned }, n.id)) close();
  }
  async function remove(n: Note) {
    // Destroying is a word and a second tap, never a pop-up (DESIGN.md, rule 8).
    if (!armed) return setArmed(true);
    if (await call("note_remove", { p_id: n.id }, n.id)) close();
  }

  const form = canAdd && (
    <form onSubmit={add} className={`flex flex-col gap-2 ${full ? "card" : ""}`}>
      <div className="flex gap-2">
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a note" maxLength={2000} aria-label="A note for the house" />
        <button type="submit" className="btn btn-primary shrink-0" disabled={busy === "add" || !text.trim()} aria-label="Add note">
          <Icon name="plus" size={20} />
        </button>
      </div>
      {text.trim() && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} />
          Just for me (nobody else sees it)
        </label>
      )}
    </form>
  );

  const list =
    shown.length === 0 ? (
      <p className={`muted text-sm ${full ? "px-1" : ""}`}>No notes yet.</p>
    ) : (
      <ul className={full ? "card flex flex-col p-0" : "flex flex-col"}>
        {shown.map((n) => {
          const words = (
            <>
              <span className="block whitespace-pre-wrap break-words">{n.body}</span>
              <span className="muted mt-0.5 block text-sm">
                {n.is_private ? "Just for me · " : n.author_name ? `${n.author_name} · ` : ""}
                {ago(n.created_at, now)}
                {n.pinned ? " · pinned" : ""}
              </span>
            </>
          );
          return (
            <li key={n.id} className={full ? "row px-4" : "row items-start"}>
              {(n.mine || admin) && !compact ? (
                // The words stay selectable; a plain tap on them, or the line under them, opens the note's sheet.
                <div className="min-w-0 grow">
                  <span className="block whitespace-pre-wrap break-words" onClick={() => { if (window.getSelection()?.isCollapsed !== false) show(n); }}>
                    {n.body}
                  </span>
                  <button type="button" className="row-link muted mt-0.5 block min-h-[44px] w-full text-left text-sm" onClick={() => show(n)} aria-haspopup="dialog">
                    {n.is_private ? "Just for me · " : n.author_name ? `${n.author_name} · ` : ""}
                    {ago(n.created_at, now)}
                    {n.pinned ? " · pinned" : ""}
                  </button>
                </div>
              ) : (
                <div className="min-w-0 grow">{words}</div>
              )}
            </li>
          );
        })}
      </ul>
    );

  const sheet = open && (
    <Sheet title={open.pinned ? "Note · pinned" : "Note"} onClose={close}>
      <p className="max-h-[40vh] overflow-y-auto whitespace-pre-wrap break-words">{open.body}</p>
      {msg && (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {msg}
        </p>
      )}
      {admin && !open.is_private && (
        <button type="button" className="btn btn-secondary w-full" disabled={busy === open.id} onClick={() => void pin(open)}>
          {open.pinned ? "Unpin" : "Pin to top"}
        </button>
      )}
      <button type="button" className="btn w-full" onClick={close}>
        Cancel
      </button>
      {/* Never the first button (DESIGN.md rule 8), and it asks twice. */}
      <button type="button" className="btn btn-danger w-full" disabled={busy === open.id} onClick={() => void remove(open)}>
        {armed ? "Tap again to delete" : "Delete note"}
      </button>
    </Sheet>
  );

  if (full) {
    return (
      <section className="flex flex-col gap-3" aria-label="Notes">
        {form}
        {msg && !open && <p className="px-1 text-sm text-[var(--danger)]">{msg}</p>}
        {list}
        {sheet}
      </section>
    );
  }

  return (
    <section className={`flex flex-col gap-3 ${bare ? "" : "card"}`} aria-labelledby={bare ? undefined : "notes-h"} aria-label={bare ? "Notes" : undefined}>
      {!bare && (
        <div className="flex items-center justify-between">
          <h2 id="notes-h" className="text-lg font-semibold">
            Notes
          </h2>
          {compact && (
            <Link prefetch={false} href="/notes" className="text-sm font-semibold text-[var(--accent)]">
              All notes ›
            </Link>
          )}
        </div>
      )}
      {form}
      {msg && !open && <p className="text-sm text-[var(--danger)]">{msg}</p>}
      {list}
      {bare && compact && (
        <Link prefetch={false} href="/notes" className="text-sm font-semibold underline">
          All notes ›
        </Link>
      )}
      {sheet}
    </section>
  );
}
