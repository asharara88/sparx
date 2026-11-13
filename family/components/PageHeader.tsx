import type { ReactNode } from "react";
import { BackLink } from "@/components/BackLink";

/**
 * Top of every screen: optional back chevron and the title on one line, with the whole width
 * to itself; the subtitle and an optional action share the line under it, so a button never
 * squeezes the title onto two lines. Large title on top-level screens (`large`). `back` is where
 * the arrow goes when the screen was opened from outside the app; from inside, it goes back.
 */
export function PageHeader({ title, back, subtitle, action, large = false }: { title: ReactNode; back?: string; subtitle?: ReactNode; action?: ReactNode; large?: boolean }) {
  return (
    <header className={`page-header ${large ? "page-header-large" : ""}`}>
      <div className="flex items-center gap-2">
        {back && <BackLink fallback={back} />}
        <h1 className="page-title min-w-0 grow">{title}</h1>
      </div>
      {(subtitle || action) && (
        <div className="mt-1 flex items-center gap-3">
          {subtitle ? <p className="page-subtitle min-w-0 grow">{subtitle}</p> : <span className="grow" />}
          {action && <div className="flex shrink-0 gap-2">{action}</div>}
        </div>
      )}
    </header>
  );
}
