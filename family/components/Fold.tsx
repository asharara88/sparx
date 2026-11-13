import { Icon, type IconName } from "./Icon";

export type Tint = "feed" | "sleep" | "diaper" | "meds" | "milk" | "pump" | "food" | "house" | "cal" | "notes" | "guide" | "danger";

/**
 * A section that opens and closes (a plain <details>, so it works server-rendered and
 * without JavaScript). The title bar stays visible in its feature colour; the body
 * shows only when opened. Home keeps the one or two that matter now open.
 */
export function Fold({ title, hint, icon, tint, open = false, wrap = false, children, className = "" }: { title: string; hint?: string | null; icon?: IconName; tint?: Tint; open?: boolean; /** A fold that is a row of a list with long titles (Week by week): the title may take two lines. */ wrap?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <details className={`fold ${tint ? `tint-${tint}` : ""} ${className}`} open={open}>
      <summary>
        {icon && (
          <span className="icon-disc" style={{ width: 34, height: 34 }}>
            <Icon name={icon} size={18} />
          </span>
        )}
        {/* The title keeps its words; the grey hint takes only the room left, and is cut first. */}
        <span className={`min-w-0 ${wrap ? "" : "truncate"} ${hint ? "" : "flex-1"}`}>{title}</span>
        {hint && <span className="fold-hint min-w-0 flex-1 truncate text-end">{hint}</span>}
        <Icon name="forward" size={18} className="fold-chev" />
      </summary>
      <div className="fold-body">{children}</div>
    </details>
  );
}
