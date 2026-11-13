import Link from "next/link";
import { Icon, type IconName } from "./Icon";

export type Tint = "feed" | "sleep" | "diaper" | "meds" | "milk" | "pump" | "food" | "house" | "cal" | "notes" | "guide" | "danger";

/**
 * Under 360 px (iPhone SE) a bar steps down a size so its name and its answer both fit
 * ("Freezer · 2 bottles · 360 ml", "Fridge lasts · till Sun"). In px, so large text
 * does not undo it. A flat fold (a row of a list) keeps its own size.
 */
const NARROW = "max-[360px]:gap-[8px] max-[360px]:px-[12px] max-[360px]:text-[17px]";

/** What a fold's bar holds, shared by Fold and FoldLink so the two look the same. */
function Bar({ title, hint, icon, wrap = false }: { title: string; hint?: string | null; icon?: IconName; wrap?: boolean }) {
  return (
    <>
      {icon && (
        <span className="icon-disc size-[34px]">
          <Icon name={icon} size={18} />
        </span>
      )}
      {/* The title keeps its words; the grey hint takes only the room left, and is cut first. */}
      <span className={`min-w-0 ${wrap ? "" : "truncate"} ${hint ? "" : "flex-1"}`}>{title}</span>
      {hint && <span className="fold-hint min-w-0 flex-1 truncate text-end">{hint}</span>}
      <Icon name="forward" size={18} className="fold-chev" />
    </>
  );
}

/**
 * A section that opens and closes (a plain <details>, so it works server-rendered and
 * without JavaScript). The title bar stays visible in its feature colour; the body
 * shows only when opened. Home keeps the one or two that matter now open.
 */
export function Fold({ title, hint, icon, tint, open = false, wrap = false, children, className = "" }: { title: string; hint?: string | null; icon?: IconName; tint?: Tint; open?: boolean; /** A fold that is a row of a list with long titles (Week by week): the title may take two lines. */ wrap?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <details className={`fold ${tint ? `tint-${tint}` : ""} ${className}`} open={open}>
      <summary className={/\bfold-flat\b/.test(className) ? undefined : NARROW}>
        <Bar title={title} hint={hint} icon={icon} wrap={wrap} />
      </summary>
      <div className="fold-body">{children}</div>
    </details>
  );
}

/**
 * A bar drawn like a fold's that opens another screen instead of a body (Milk's Pumping,
 * which opens Home's day cards), so it sits in line with the folds around it.
 */
export function FoldLink({ href, title, hint, icon, tint, className = "" }: { href: string; title: string; hint?: string | null; icon?: IconName; tint?: Tint; className?: string }) {
  return (
    <Link prefetch={false} href={href} className={`fold fold-link ${NARROW} ${tint ? `tint-${tint}` : ""} ${className}`}>
      <Bar title={title} hint={hint} icon={icon} />
    </Link>
  );
}
