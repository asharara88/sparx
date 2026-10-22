"use client";
/**
 * Read the text off a photo on the phone (a note, a label, a prescription).
 * Tesseract is loaded from a CDN only when first needed (a few MB, cached by
 * the browser afterwards). Nothing is sent anywhere.
 */
const TESSERACT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";

interface TesseractGlobal {
  recognize(image: File | string, lang: string, opts?: Record<string, unknown>): Promise<{ data: { text: string } }>;
}

let loading: Promise<TesseractGlobal> | null = null;
function loadTesseract(): Promise<TesseractGlobal> {
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const w = window as unknown as { Tesseract?: TesseractGlobal };
    if (w.Tesseract) return resolve(w.Tesseract);
    const s = document.createElement("script");
    s.src = TESSERACT_URL;
    s.async = true;
    s.onload = () => (w.Tesseract ? resolve(w.Tesseract) : reject(new Error("OCR did not load.")));
    s.onerror = () => reject(new Error("Could not load the text reader. Check the connection and try again."));
    document.head.appendChild(s);
  });
  return loading;
}

/** Text found on the photo, roughly in reading order. Empty string when none. */
export async function readText(file: File, onProgress?: (p: number) => void): Promise<string> {
  const t = await loadTesseract();
  const { data } = await t.recognize(file, "eng", {
    logger: (m: { status?: string; progress?: number }) => {
      if (m.status === "recognizing text" && typeof m.progress === "number") onProgress?.(m.progress);
    },
  });
  return (data.text ?? "").replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
}

/** Pull the usual fields off an appliance label. Best effort; the person confirms. */
export function parseLabel(text: string): { brand?: string; model?: string; serial?: string } {
  const out: { brand?: string; model?: string; serial?: string } = {};
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const grab = (re: RegExp) => {
    for (const l of lines) {
      const m = l.match(re);
      if (m && m[1]) return m[1].replace(/[^A-Za-z0-9\-\/. ]/g, "").trim();
    }
    return undefined;
  };
  out.model = grab(/\b(?:model|modell|mod\.?|type|typ)\s*(?:no\.?|number|#|:)?\s*[:#]?\s*([A-Z0-9][A-Z0-9\-\/.]{2,})/i);
  out.serial = grab(/\b(?:serial|ser\.?|s\/n|sn)\s*(?:no\.?|number|#|:)?\s*[:#]?\s*([A-Z0-9][A-Z0-9\-\/.]{3,})/i);
  const brands = ["Daikin", "Samsung", "LG", "Bosch", "Siemens", "Whirlpool", "Electrolux", "Carrier", "Gree", "Midea", "Panasonic", "Hitachi", "Miele", "Dyson", "Philips", "Sharp", "Toshiba", "Haier", "Beko", "Ariston", "Rheem", "AO Smith", "Mitsubishi", "York", "Trane", "Zanussi", "Smeg", "KitchenAid", "Hoover", "Candy", "Indesit", "De'Longhi", "Nespresso", "Apple", "Sony"];
  for (const b of brands) if (new RegExp(`\\b${b.replace(/[.'*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)) { out.brand = b; break; }
  return out;
}
