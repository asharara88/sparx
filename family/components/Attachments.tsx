"use client";
import { useEffect, useState } from "react";
import type { Attachment } from "@/lib/types";
import { supabaseBrowser } from "@/lib/supabase/client";
import { uploadPhoto } from "@/lib/photos";
import { Photo } from "./Photo";
import { PhotoPicker } from "./PhotoPicker";

/** Photos on an entry, ticket, asset or profile; add one with optional text read off it. */
export function Attachments({
  module,
  table,
  entityId,
  folder,
  canAdd,
  withText = true,
  title = "Photos",
}: {
  module: string;
  table: "care_entries" | "tickets" | "assets" | "care_subjects";
  entityId: string;
  folder: "entries" | "tickets" | "assets" | "subjects";
  canAdd: boolean;
  withText?: boolean;
  title?: string;
}) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  async function load() {
    const { data } = await supabaseBrowser().rpc("attachments_list", { p_table: table, p_entity_id: entityId });
    setItems(((data as { attachments?: Attachment[] })?.attachments ?? []) as Attachment[]);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId]);

  async function add() {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      const path = await uploadPhoto(file, folder);
      const { data, error } = await supabaseBrowser().rpc("attachment_add", { p_module: module, p_table: table, p_entity_id: entityId, p_path: path, p_caption: null, p_ocr_text: text || null });
      const res = data as { ok: boolean; message?: string } | null;
      if (error || !res?.ok) throw new Error(res?.message ?? error?.message ?? "Could not add the photo.");
      setFile(null);
      setText("");
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not add the photo.");
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    if (!confirm("Remove this photo?")) return;
    await supabaseBrowser().rpc("attachment_remove", { p_id: id });
    await load();
  }

  return (
    <section className="card">
      <h2 className="font-semibold">{title}</h2>
      {items.length > 0 && (
        <ul className="mt-2 grid grid-cols-3 gap-2">
          {items.map((a) => (
            <li key={a.id}>
              <button type="button" className="block w-full" onClick={() => setOpen(open === a.id ? null : a.id)} aria-label={a.caption ?? "Photo"}>
                <Photo path={a.path} alt={a.caption ?? ""} className="aspect-square w-full" />
              </button>
              {open === a.id && (
                <div className="mt-1 text-sm">
                  {a.ocr_text && <p className="muted whitespace-pre-wrap">{a.ocr_text.slice(0, 300)}</p>}
                  <button type="button" className="underline" onClick={() => remove(a.id)}>
                    Remove
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {canAdd && (
        <div className="mt-3 flex flex-col gap-2">
          <PhotoPicker label="Add a photo" file={file} onFile={setFile} withText={withText} onText={setText} disabled={busy} />
          {text && <p className="muted max-h-24 overflow-auto whitespace-pre-wrap text-sm">{text}</p>}
          {file && (
            <button type="button" className="btn btn-primary" onClick={add} disabled={busy}>
              {busy ? "Saving…" : "Save photo"}
            </button>
          )}
          {msg && <p className="text-sm text-[var(--danger)]">{msg}</p>}
        </div>
      )}
    </section>
  );
}
