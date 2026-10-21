import Link from "next/link";
import type { DueItem } from "@/lib/types";
import { fmtDate } from "@/lib/time";
import { Icon } from "./Icon";

/** One line on the home screen: the next vaccine visit, red once its window has closed. */
export function VaccineNotice({ item, timezone }: { item: DueItem; timezone: string }) {
  const when = item.due_on ? fmtDate(`${item.due_on}T12:00:00Z`, "UTC", { day: "numeric", month: "short" }) : "";
  void timezone;
  return (
    <Link href="/baby/vaccines" className={`notice ${item.overdue ? "notice-danger" : "notice-accent"} row-link flex items-center gap-3`}>
      <Icon name="syringe" size={20} className="shrink-0" />
      <span className="flex-1">
        <span className="font-semibold">
          {item.visit} vaccines {item.overdue ? "overdue" : `due around ${when}`}
        </span>
        <span className="muted block text-sm">
          {item.count} dose{item.count === 1 ? "" : "s"} to record
        </span>
      </span>
      <Icon name="forward" size={18} className="muted shrink-0" />
    </Link>
  );
}
