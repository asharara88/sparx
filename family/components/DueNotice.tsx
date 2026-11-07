"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * A Now item that appears on its own once its time comes, with Home left open: the
 * server cannot know when the phone will be looked at, so the clock runs here
 * (every 30 s). Renders nothing before `fromMs`, so the Now slot moves on to the next
 * candidate until then (.now-queue in globals.css).
 */
export function DueNotice({ fromMs, children, className = "notice notice-warn", href }: { fromMs: number; children: React.ReactNode; className?: string; /** Where tapping it goes (the Feeds section for "feed due"); nothing is rendered before its time either way. */ href?: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (now == null || now < fromMs) return null;
  return href ? (
    <Link prefetch={false} href={href} className={`${className} block no-underline`}>
      {children}
    </Link>
  ) : (
    <p className={className}>{children}</p>
  );
}
