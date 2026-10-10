"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CalendarEvent, ShelfItem, ShoppingRequest } from "@/lib/types";
import { EVENT_KINDS } from "@/lib/types";
import { fmtTime } from "@/lib/time";
import { supabaseBrowser } from "@/lib/supabase/client";
import { uploadPhoto } from "@/lib/photos";

export function SendRequest({
  shelf,
  recent,
  events,
  timezone,
  today,
}: {
  shelf: ShelfItem[];
  recent: ShoppingRequest[];
  events: CalendarEvent[];
  timezone: string;
  today: string;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<ShelfItem | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const todays = events.filter((e) => e.date === today);

  async function sendShelf(item: ShelfItem) {
    setBusy(true);
    setMsg(null);
    const { data, error } = await supabaseBrowser().rpc("shopping_request_create", {
      p_shelf_item_id: item.id,
      p_item_name: null,
      p_note: null,
      p_photo_path: null,
    });
    setBusy(false);
    setConfirm(null);
    const res = data as { ok: boolean; message?: string } | null;
    if (error || !res?.ok) return setMsg(res?.message ?? error?.message ?? "Could not send.");
    setDone(`Sent: ${item.name} is running low.`);
    router.refresh();
  }

  async function sendPhoto(e: React.FormEvent) {
    e.preventDefault();
    if (!file && !note.trim()) return setMsg("Take a photo or write what is running out.");
    setBusy(true);
    setMsg(null);
    try {
      const path = file ? await uploadPhoto(file, "requests") : null;
      const { data, error } = await supabaseBrowser().rpc("shopping_request_create", {
        p_shelf_item_id: null,
        p_item_name: note.trim() ? note.trim().slice(0, 60) : null,
        p_note: note.trim() || null,
        p_photo_path: path,
      });
      const res = data as { ok: boolean; message?: string } | null;
      if (error || !res?.ok) throw new Error(res?.message ?? error?.message ?? "Could not send.");
      setDone("Sent. Mido or Dana will see it.");
      setFile(null);
      setNote("");
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Could not send.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="pt-2">
        <h1 className="text-3xl font-bold">Running low?</h1>
        <p className="muted">Tap the item. Or take a photo.</p>
      </header>

      {done && (
        <p role="status" className="rounded-xl border-2 border-green-700 bg-green-50 p-3 font-semibold text-green-900">
          {done}
        </p>
      )}
      {msg && (
        <p role="alert" className="rounded-xl border-2 border-red-700 p-3 text-red-800">
          {msg}
        </p>
      )}

      {confirm && (
        <div className="card border-[var(--accent)]">
          <p className="text-xl font-bold">
            Send “{confirm.name} is running low”?
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <button className="btn" onClick={() => setConfirm(null)} disabled={busy}>
              No
            </button>
            <button className="btn btn-primary" onClick={() => sendShelf(confirm)} disabled={busy}>
              {busy ? "Sending…" : "Yes, send"}
            </button>
          </div>
        </div>
      )}

      <section className="card">
        <div className="grid grid-cols-2 gap-3">
          {shelf.map((s) => (
            <button key={s.id} className="btn min-h-[72px] flex-col text-lg" onClick={() => { setDone(null); setConfirm(s); }} disabled={busy}>
              <span aria-hidden className="text-3xl leading-none">
                {s.emoji}
              </span>
              {s.name}
            </button>
          ))}
        </div>
      </section>

      <form onSubmit={sendPhoto} className="card flex flex-col gap-3">
        <h2 className="text-xl font-bold">Something else</h2>
        <label className="btn min-h-[72px] text-lg">
          📷 {file ? file.name : "Take a photo"}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What is it? (optional)" />
        <button type="submit" className="btn btn-primary min-h-[64px] text-lg" disabled={busy}>
          {busy ? "Sending…" : "Send"}
        </button>
      </form>

      {todays.length > 0 && (
        <section className="card">
          <h2 className="text-xl font-bold">Today at home</h2>
          <ul className="mt-2 flex flex-col gap-1">
            {todays.map((e) => (
              <li key={e.id + e.starts_at}>
                <span aria-hidden>{EVENT_KINDS.find((k) => k.id === e.kind)?.icon} </span>
                {e.all_day ? "All day" : fmtTime(e.starts_at, timezone)} · {e.title}
                {e.note ? ` · ${e.note}` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}

      {recent.length > 0 && (
        <section className="card">
          <h2 className="text-xl font-bold">What you sent</h2>
          <ul className="mt-2 flex flex-col gap-1">
            {recent.map((r) => (
              <li key={r.id}>
                {r.status === "pending" ? "⏳" : r.status === "approved" ? "✅" : "⛔"} {r.item_name}
                {r.status === "pending" ? " · waiting" : r.status === "approved" ? " · on the list" : " · not needed"}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
