"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { HomeSummary, MilkData } from "@/lib/types";
import { fmtDuration, fmtTime } from "@/lib/time";
import { shortFeedHint } from "@/lib/forecast";
import { Icon } from "./Icon";

/** Three tiles: next feed, asleep or awake for how long, milk in the fridge. */
export function RightNow({ summary, milk, timezone }: { summary: HomeSummary; milk: MilkData | null; timezone: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const feed = summary.last["lana.feed"];
  const sleep = summary.last["lana.sleep"];
  const asleep = summary.ongoing.find((e) => e.type_id === "lana.sleep");
  const due = feed?.next_due ? Date.parse(feed.next_due) : null;
  const n = now ?? Date.parse(summary.today + "T00:00:00Z");
  const since = (iso: string) => fmtDuration(Math.max(0, Math.round((n - Date.parse(iso)) / 60_000)));
  const feedDue = due != null && now != null && due <= now;
  const hint = feed && typeof feed.fullness === "number" ? shortFeedHint(feed, feed.fullness) : null;
  const fridge = milk?.fridge_ml ?? 0;
  const bottles = milk?.fridge_count ?? 0;
  const tile = "tile flex min-w-[9.5rem] shrink-0 snap-start flex-col justify-between gap-2";
  return (
    <section aria-label="Right now" className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1">
      <Link href="/lana" className={`${tile} ${feedDue ? "bg-[var(--accent)] text-[var(--accent-fg)]" : ""}`}>
        <Icon name="bottle" size={26} />
        <div>
          <p className="text-xs font-bold uppercase tracking-wide opacity-75">Next feed</p>
          <p className="text-xl font-bold">{due == null || now == null ? "—" : feedDue ? "Due now" : `in ${fmtDuration(Math.round((due - now) / 60_000))}`}</p>
          <p className="text-sm opacity-80">{hint ?? (feed ? `last ${fmtTime(feed.occurred_at, timezone)}` : "No feed yet")}</p>
        </div>
      </Link>
      <Link href="/lana" className={`${tile} ${asleep ? "bg-[var(--fg)] text-[var(--bg)]" : ""}`}>
        <Icon name={asleep ? "zzz" : "sun"} size={26} />
        <div>
          <p className="text-xs font-bold uppercase tracking-wide opacity-75">{asleep ? "Asleep" : "Awake"}</p>
          <p className="text-xl font-bold">{now == null ? "—" : asleep ? since(asleep.occurred_at) : sleep?.ended_at ? since(sleep.ended_at) : "—"}</p>
          <p className="text-sm opacity-80">{asleep ? `since ${fmtTime(asleep.occurred_at, timezone)}` : sleep?.ended_at ? `woke ${fmtTime(sleep.ended_at, timezone)}` : "no sleep logged"}</p>
        </div>
      </Link>
      <Link href="/lana/milk" className={`${tile} ${milk && fridge < 120 ? "bg-[var(--warn-soft)]" : ""}`}>
        <Icon name="droplet" size={26} />
        <div>
          <p className="text-xs font-bold uppercase tracking-wide opacity-75">Fridge</p>
          <p className="text-xl font-bold">{milk ? `${fridge} ml` : "—"}</p>
          <p className="text-sm opacity-80">{milk ? `${bottles} bottle${bottles === 1 ? "" : "s"} · ${milk.freezer_ml} ml frozen` : ""}</p>
        </div>
      </Link>
    </section>
  );
}
