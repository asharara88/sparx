"use client";
import { Icon } from "@/components/Icon";

/** Opens the phone's print / Save as PDF sheet for the export page. */
export function PrintButton({ label = "Print or save as PDF" }: { label?: string }) {
  return (
    <button type="button" className="btn btn-primary no-print" onClick={() => window.print()}>
      <Icon name="printer" size={20} /> {label}
    </button>
  );
}
