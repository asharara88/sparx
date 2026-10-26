import { Icon, type IconName } from "./Icon";

export type Tint = "feed" | "sleep" | "diaper" | "meds" | "milk" | "pump" | "house" | "cal" | "notes" | "guide" | "danger";

/**
 * A section that opens and closes (a plain <details>, so it works server-rendered and
 * without JavaScript). The title bar stays visible in its feature colour; the body
 * shows only when opened. Home keeps the one or two that matter now open.
 */
export function Fold({ title, hint, icon, tint, open = false, children, className = "" }: { title: string; hint?: string | null; icon?: IconName; tint?: Tint; open?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <details className={`fold ${tint ? `tint-${tint}` : ""} ${className}`} open={open}>
      <summary>
        {icon && (
          <span className="icon-disc" style={{ width: 34, height: 34 }}>
            <Icon name={icon} size={18} />
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {hint && <span className="fold-hint truncate">{hint}</span>}
        <Icon name="forward" size={18} className="fold-chev" />
      </summary>
      <div className="fold-body">{children}</div>
    </details>
  );
}
