"use client";
import { useRef, useState } from "react";
import { readText } from "@/lib/ocr";
import { Icon } from "@/components/Icon";

/** Take or choose a photo; optionally read the text off it on the phone. */
export function PhotoPicker({
  label = "Take a photo",
  file,
  onFile,
  withText = false,
  onText,
  disabled,
  library = false,
}: {
  label?: string;
  file: File | null;
  onFile: (f: File | null) => void;
  withText?: boolean;
  onText?: (text: string) => void;
  disabled?: boolean;
  /** Also allow picking from the photo library (a screenshot of an order), not only the camera. */
  library?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  function pick(f: File | null) {
    setErr(null);
    onFile(f);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(f ? URL.createObjectURL(f) : null);
  }
  async function read() {
    if (!file) return;
    setErr(null);
    setReading(0);
    try {
      const text = await readText(file, (p) => setReading(p));
      onText?.(text);
      if (!text) setErr("No text found on the photo. Try closer, with more light.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not read the photo.");
    } finally {
      setReading(null);
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <label className={`btn min-h-[64px] text-lg ${disabled ? "opacity-50" : ""}`}>
        <Icon name="camera" size={20} /> {file ? "Change photo" : label}
        <input ref={ref} type="file" accept="image/*" capture={library ? undefined : "environment"} className="sr-only" disabled={disabled} onChange={(e) => pick(e.target.files?.[0] ?? null)} />
      </label>
      {preview && (
        <div className="flex items-start gap-3">
          <img src={preview} alt="" className="h-28 w-28 rounded-xl object-cover" />
          <div className="flex flex-col gap-2">
            {withText && (
              <button type="button" className="btn" onClick={read} disabled={disabled || reading !== null}>
                {reading === null ? "Read the label" : `Reading… ${Math.round(reading * 100)}%`}
              </button>
            )}
            <button type="button" className="btn" onClick={() => { pick(null); if (ref.current) ref.current.value = ""; }} disabled={disabled}>
              Remove
            </button>
          </div>
        </div>
      )}
      {err && <p className="text-sm text-[var(--warn)]">{err}</p>}
    </div>
  );
}
