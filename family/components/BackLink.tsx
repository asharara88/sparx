"use client";
import type React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { cameFromApp } from "@/lib/nav-history";

/**
 * The screen's Back arrow: back to where the person came from in the app (Vaccines opened from
 * About her goes back to About her, not to Today), else to the screen's own fallback.
 * Render it as <BackLink fallback=… />; it is a client component.
 */
export function BackLink({ fallback }: { fallback: string }) {
  const router = useRouter();
  const path = usePathname();
  const onClick = (e: React.MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (cameFromApp(path)) {
      e.preventDefault();
      router.back();
    }
  };
  return (
    <Link prefetch={false} href={fallback} onClick={onClick} className="icon-btn" aria-label="Back">
      <Icon name="back" size={24} />
    </Link>
  );
}
