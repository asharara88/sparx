"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RpcError } from "@/lib/types";
import { supabaseBrowser } from "@/lib/supabase/client";
import { uploadPhoto } from "@/lib/photos";
import { PhotoPicker } from "./PhotoPicker";

/** Photograph a receipt → it is read into lines → you check the matches → apply. */
export function ReceiptCapture() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<"idle" | "upload" | "read">("idle");
  const [msg, setMsg] = useState<string | null>(null);

  async function go() {
    if (!file) return;
    setMsg(null);
    try {
      setStep("upload");
      const path = await uploadPhoto(file, "receipts");
      const { data, error } = await supabaseBrowser().rpc("receipt_create", { p_photo_path: path, p_ocr_text: null });
      const res = data as { ok: boolean; id?: string; message?: string } | null;
      if (error || !res?.ok || !res.id) throw new Error(res?.message ?? error?.message ?? "Could not save the receipt.");
      setStep("read");
      const r = await fetch("/api/receipts/read", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: res.id }) });
      const out = (await r.json()) as { ok: true; lines: number; matched: number; is_receipt: boolean } | RpcError;
      if (!out.ok) {
        // The photo and the receipt row are kept; the review screen lets you fix it or discard it.
        setMsg(out.message ?? "Could not read it.");
        router.push(`/shopping/receipts/${res.id}`);
        return;
      }
      router.push(`/shopping/receipts/${res.id}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Something went wrong.");
      setStep("idle");
    }
  }

  return (
    <section className="card flex flex-col gap-3">
      <h2 className="text-xl font-bold">Photograph a receipt</h2>
      <p className="muted text-sm">A paper receipt flat in good light, or a screenshot of the order page in Talabat, Amazon or Noon. It is read line by line and matched to the list; you check anything it is not sure about.</p>
      <PhotoPicker label="Receipt photo or order screenshot" file={file} onFile={setFile} disabled={step !== "idle"} library />
      {msg && (
        <p role="alert" className="rounded-xl border-2 border-red-700 p-3 text-red-800">
          {msg}
        </p>
      )}
      <button type="button" className="btn btn-primary min-h-[64px] text-lg" disabled={!file || step !== "idle"} onClick={go}>
        {step === "idle" ? "Read the receipt" : step === "upload" ? "Uploading…" : "Reading… (10–20 s)"}
      </button>
    </section>
  );
}
