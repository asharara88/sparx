import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/Icon";

/**
 * Top of every screen: optional back chevron, title, optional subtitle, optional action on the right.
 * Large title on top-level screens (`large`), compact on the ones you drill into.
 */
export function PageHeader({ title, back, subtitle, action, large = false }: { title: ReactNode; back?: string; subtitle?: ReactNode; action?: ReactNode; large?: boolean }) {
  return (
    <header className={`page-header ${large ? "page-header-large" : ""}`}>
      <div className="flex items-center gap-2">
        {back && (
          <Link href={back} className="icon-btn" aria-label="Back">
            <Icon name="back" size={24} />
          </Link>
        )}
        <div className="min-w-0 grow">
          <h1 className="page-title">{title}</h1>
          {subtitle && <p className="page-subtitle">{subtitle}</p>}
        </div>
        {action}
      </div>
    </header>
  );
}
