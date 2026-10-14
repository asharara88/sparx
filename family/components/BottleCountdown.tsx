"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { MilkData } from "@/lib/types";
import { fmtTime } from "@/lib/time";
import { Icon } from "@/components/Icon";

/**
 * The milk line on the home screen: what is in the fridge, and while Mama is out, when the
 * next bottle is due (last feed + the household's bottle interval). Ticks every minute.
 */
export function BottleCountdown({ milk, lastFeedAt, mamaAway, timezone, nextAtIso }: { milk: MilkData; lastFeedAt: string | null; mamaAway: boolean; timezone: string; nextAtIso?: string | null }) {
  // Set after mount so the server and the phone render the same HTML.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const nextAt = nextAtIso ? new Date(nextAtIso).getTime() : lastFeedAt ? new Date(lastFeedAt).getTime() + milk.bottle_interval_min * 60_000 : null;
  const minLeft = nextAt && now ? Math.round((nextAt - now) / 60_000) : null;
  const low = milk.fridge_ml < milk.target_ml;
  const next = milk.bottles.find((b) => b.location === "fridge" && !b.expired);
  return (
    <Link href="/lana/milk" className={`notice ${mamaAway && minLeft != null && minLeft <= 15 ? "notice-warn" : ""} row-link flex items-center gap-3`}>
      <Icon name="bottle" size={22} className="shrink-0" />
      <span className="min-w-0 grow">
        <span className="block font-semibold">
          {milk.fridge_ml} ml in the fridge
          <span className={`font-normal ${low ? "text-[var(--warn)]" : "muted"}`}> · aim {milk.target_ml}</span>
          {milk.freezer_ml > 0 ? <span className="muted font-normal"> · {milk.freezer_ml} ml frozen</span> : null}
        </span>
        <span className="muted block text-sm">
          {mamaAway && nextAt && minLeft != null
            ? minLeft > 0
              ? `Next bottle in ${minLeft >= 60 ? `${Math.floor(minLeft / 60)} h ${minLeft % 60} min` : `${minLeft} min`} (about ${fmtTime(new Date(nextAt).toISOString(), timezone)})`
              : `A bottle is due (${Math.abs(minLeft)} min ago)`
            : next
              ? `Use the ${next.amount_ml} ml from ${fmtTime(next.pumped_at, timezone)} first`
              : "Nothing in the fridge"}
        </span>
      </span>
      <Icon name="forward" size={18} className="shrink-0 text-[var(--muted)]" />
    </Link>
  );
}
