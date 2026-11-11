"use client";
import { useEffect } from "react";

/**
 * iPhone keeps fixed elements on the full screen when the keyboard opens: a sheet's Save
 * button and the tab bar end up behind the keyboard, or floating mid-screen. This publishes
 * the part of the screen that is really visible (the visual viewport) as CSS variables,
 * --vv-h and --vv-top, which sheets size themselves to (globals.css), and marks the page
 * `kb-open` while a field is being typed in, which hides the tab bar and drops the helper's
 * text box onto the keyboard. Pinch-zoom also shrinks the visual viewport; it is told apart
 * by its scale and changes nothing.
 */
export function ViewportVars() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    let raf = 0;
    const isField = (el: Element | null) =>
      !!el && (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el instanceof HTMLInputElement && !["button", "checkbox", "radio", "range", "submit", "reset", "file", "color"].includes(el.type)) || (el as HTMLElement).isContentEditable);
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (vv.scale > 1.05) {
          // Zoomed in: leave the screen's own sizes alone.
          root.style.removeProperty("--vv-h");
          root.style.removeProperty("--vv-top");
          root.classList.remove("kb-open");
          return;
        }
        root.style.setProperty("--vv-h", `${Math.round(vv.height)}px`);
        root.style.setProperty("--vv-top", `${Math.round(vv.offsetTop)}px`);
        const covered = window.innerHeight - vv.height * vv.scale;
        root.classList.toggle("kb-open", covered > 120 && isField(document.activeElement));
      });
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    window.addEventListener("focusin", update);
    window.addEventListener("focusout", update);
    return () => {
      cancelAnimationFrame(raf);
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      window.removeEventListener("focusin", update);
      window.removeEventListener("focusout", update);
      root.classList.remove("kb-open");
    };
  }, []);
  return null;
}
