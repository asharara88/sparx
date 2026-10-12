"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Asset } from "@/lib/types";
import { ASSET_CATEGORIES } from "@/lib/types";
import { parseLabel } from "@/lib/ocr";
import { supabaseBrowser } from "@/lib/supabase/client";
import { uploadPhoto } from "@/lib/photos";
import { Photo } from "./Photo";
import { PhotoPicker } from "./PhotoPicker";

/** Photograph the label once; the model and serial are read off it and you confirm. */
export function AssetForm({ asset, onDone }: { asset: Asset | null; onDone?: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(asset?.name ?? "");
  const [category, setCategory] = useState(asset?.category ?? "appliance");
  const [location, setLocation] = useState(asset?.location ?? "");
  const [brand, setBrand] = useState(asset?.brand ?? "");
  const [model, setModel] = useState(asset?.model ?? "");
  const [serial, setSerial] = useState(asset?.serial ?? "");
  const [purchased, setPurchased] = useState(asset?.purchased_on ?? "");
  const [warranty, setWarranty] = useState(asset?.warranty_until ?? "");
  const [supplier, setSupplier] = useState(asset?.supplier ?? "");
  const [notes, setNotes] = useState(asset?.notes ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [labelText, setLabelText] = useState("");
  const [readMsg, setReadMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function onText(text: string) {
    setLabelText(text);
    const got = parseLabel(text);
    if (got.brand && !brand) setBrand(got.brand);
    if (got.model && !model) setModel(got.model);
    if (got.serial && !serial) setSerial(got.serial);
    const found = [got.brand && "brand", got.model && "model", got.serial && "serial"].filter(Boolean);
    setReadMsg(found.length ? `Read ${found.join(", ")} off the label. Check it.` : "Read the label but could not spot a model or serial. Fill them in from the text below.");
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const path = file ? await uploadPhoto(file, "assets") : null;
      const { data, error } = await supabaseBrowser().rpc("asset_save", {
        p_id: asset?.id ?? null,
        p_name: name,
        p_category: category,
        p_location: location || null,
        p_brand: brand || null,
        p_model: model || null,
        p_serial: serial || null,
        p_purchased_on: purchased || null,
        p_warranty_until: warranty || null,
        p_supplier: supplier || null,
        p_notes: notes || null,
        p_label_path: path,
        p_label_text: labelText || null,
        p_is_active: true,
      });
      const res = data as { ok: boolean; id?: string; message?: string } | null;
      if (error || !res?.ok) throw new Error(res?.message ?? error?.message ?? "Could not save.");
      onDone?.();
      router.push("/house/assets");
      router.refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="card flex flex-col gap-3">
      <h2 className="text-xl font-bold">{asset ? `Edit ${asset.name}` : "Add an appliance"}</h2>
      <div>
        <p className="font-semibold">Label</p>
        <p className="muted text-sm">Photograph the sticker with the model and serial number. Then tap “Read the label”.</p>
        {asset?.label_path && !file && <Photo path={asset.label_path} alt="Label" className="mt-2 h-32 w-full max-w-xs" />}
        <div className="mt-2">
          <PhotoPicker label="Photograph the label" file={file} onFile={setFile} withText onText={onText} disabled={busy} />
        </div>
        {readMsg && <p className="mt-1 text-sm text-[var(--ok)]">{readMsg}</p>}
        {labelText && <p className="muted mt-1 max-h-24 overflow-auto whitespace-pre-wrap text-xs">{labelText}</p>}
      </div>
      <label className="flex flex-col gap-1">
        <span className="font-semibold">Name</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Bedroom AC, Dishwasher…" required />
      </label>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Category">
        {ASSET_CATEGORIES.map((c) => (
          <button key={c.id} type="button" className="chip" aria-pressed={category === c.id} onClick={() => setCategory(c.id)}>
            {c.icon} {c.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Room" aria-label="Room" />
        <input className="input" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Brand" aria-label="Brand" />
        <input className="input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="Model" aria-label="Model" />
        <input className="input" value={serial} onChange={(e) => setSerial(e.target.value)} placeholder="Serial number" aria-label="Serial number" />
        <label className="flex flex-col gap-1">
          <span className="muted text-sm">Bought on</span>
          <input className="input" type="date" value={purchased} onChange={(e) => setPurchased(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="muted text-sm">Warranty until</span>
          <input className="input" type="date" value={warranty} onChange={(e) => setWarranty(e.target.value)} />
        </label>
        <input className="input" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Bought from" aria-label="Bought from" />
      </div>
      <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (filter size, remote, service contract…)" aria-label="Notes" />
      {msg && (
        <p role="alert" className="notice notice-danger">
          {msg}
        </p>
      )}
      <button type="submit" className="btn btn-primary min-h-[64px] text-lg" disabled={busy || !name.trim()}>
        {busy ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
