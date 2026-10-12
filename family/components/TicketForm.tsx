"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Asset } from "@/lib/types";
import { supabaseBrowser } from "@/lib/supabase/client";
import { uploadPhoto } from "@/lib/photos";
import { PhotoPicker } from "./PhotoPicker";

/** Open a ticket: a photo and a line is enough. Admins can pick the asset and priority. */
export function TicketForm({ assets, simple = false, afterSave = "/house" }: { assets: Asset[]; simple?: boolean; afterSave?: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [assetId, setAssetId] = useState("");
  const [priority, setPriority] = useState<"low" | "normal" | "urgent">("normal");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() && !file) return setMsg("Say what is wrong, or add a photo.");
    setBusy(true);
    setMsg(null);
    try {
      const path = file ? await uploadPhoto(file, "tickets") : null;
      const asset = assets.find((a) => a.id === assetId);
      const { data, error } = await supabaseBrowser().rpc("ticket_create", {
        p_title: title.trim() || null,
        p_description: description.trim() || null,
        p_location: location.trim() || asset?.location || null,
        p_asset_id: assetId || null,
        p_priority: priority,
        p_photo_path: path,
      });
      const res = data as { ok: boolean; id?: string; message?: string } | null;
      if (error || !res?.ok) throw new Error(res?.message ?? error?.message ?? "Could not open the ticket.");
      if (simple) {
        setDone("Sent. Mido or Dana will see it.");
        setTitle("");
        setDescription("");
        setFile(null);
      } else {
        router.push(`${afterSave}/tickets/${res.id}`);
      }
      router.refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Could not open the ticket.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card flex flex-col gap-3">
      {!simple && <h1 className="page-title">Something to fix</h1>}
      {done && (
        <p role="status" className="rounded-xl border-2 border-green-700 bg-green-50 p-3 font-semibold text-green-900">
          {done}
        </p>
      )}
      <PhotoPicker file={file} onFile={setFile} disabled={busy} />
      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What is wrong? (e.g. AC in the bedroom is leaking)" aria-label="What is wrong" />
      {!simple && (
        <>
          <textarea className="input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="More detail (optional)" aria-label="Details" />
          <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Where? (room)" aria-label="Where" />
          {assets.length > 0 && (
            <select className="input" value={assetId} onChange={(e) => setAssetId(e.target.value)} aria-label="Which appliance">
              <option value="">Which appliance? (optional)</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.location ? ` · ${a.location}` : ""}
                </option>
              ))}
            </select>
          )}
          <div className="flex flex-wrap gap-2" role="group" aria-label="Priority">
            {(["low", "normal", "urgent"] as const).map((p) => (
              <button key={p} type="button" className="chip" aria-pressed={priority === p} onClick={() => setPriority(p)}>
                
                {p[0].toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
        </>
      )}
      {msg && (
        <p role="alert" className="rounded-xl border-2 border-red-700 p-3 text-red-800">
          {msg}
        </p>
      )}
      <button type="submit" className="btn btn-primary min-h-[64px] text-lg" disabled={busy}>
        {busy ? "Sending…" : simple ? "Send" : "Open ticket"}
      </button>
    </form>
  );
}
