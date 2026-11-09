"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

/**
 * A sheet that slides up from the bottom (DESIGN.md, "The patterns we use"): a title and a
 * close button on top, whatever it holds below. Tapping outside or Escape closes it. It is
 * drawn at the top of the page (a portal to <body>), never inside whatever opened it: a sheet
 * opened from inside a card was flattened by ".card .card" and lost its own cards and chips.
 */
/** `fill`: a tall sheet whose own content scrolls inside it (a chat), so the title and Close stay put. */
export function Sheet({ title, onClose, children, fill = false }: { title: string; onClose: () => void; children: React.ReactNode; fill?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => setHost(document.body), []);
  const node = (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div className={fill ? "sheet sheet-fill" : "sheet"} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="flex shrink-0 items-center justify-between">
          <p className="action-label">{title}</p>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="x" size={22} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
  return host ? createPortal(node, host) : node;
}
