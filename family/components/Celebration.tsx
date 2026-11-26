"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { headline, tierOf, track } from "@/lib/achievements";
import { cheerFor, type Cheer } from "@/lib/cheers";
import { buzz } from "@/lib/moment";
import { Icon } from "./Icon";
import { Medal } from "./Medal";

export interface FreshBadge {
  id: string;
  badge: string;
  tier: number;
  mine: boolean;
}

const COLOURS = ["#c2476a", "#f6b8c9", "#ffd37a", "#9fd8b8", "#9ec9f0", "#c9b6f2", "#ffb38a"];

/**
 * The moment a badge is won (Mido, 9 November: "dopamine triggering"): the screen dims,
 * confetti bursts, the medal spins in, the phone buzzes, and it says what was won. Once per
 * person per badge (achievements_seen, on every phone). With several new at once, the best is
 * shown and the rest counted. Nothing moves for someone who asked for less motion.
 *
 * It never stands between a parent and the log (12 November: at 3 am the medal covered Home
 * before a feed could be tapped). Home opens as usual with one slim line over the tab bar,
 * "You won Bronze ›"; tapping it plays the moment. Left alone it slips away after a while
 * and comes back on the next open, until it has been seen.
 */
export function Celebration({ fresh, cheers = [], today, timezone }: { fresh: FreshBadge[]; /** Cheers the member has not opened, oldest first (achievements_check). */ cheers?: Cheer[]; today: string; timezone: string }) {
  // Cheers come first: a person said something, and that outranks a medal. One line at a
  // time on the same spot, so a cheer and a medal new together are never two lines.
  const [at, setAt] = useState(0);
  const [opened, setOpened] = useState(false);
  const [later, setLater] = useState(false);
  const notNow = useCallback(() => setLater(true), []);
  const cheer = cheers[at];
  if (cheer) {
    // "Not now", or left alone: every line steps aside for this visit. Nothing is marked, so it is all there next time.
    if (later) return null;
    return <CheerMoment key={cheer.id} cheer={cheer} more={cheers.length - at - 1} startOpen={opened} today={today} timezone={timezone} onOpen={() => setOpened(true)} onNext={() => setAt((n) => n + 1)} onLater={notNow} />;
  }
  return <MedalMoment fresh={fresh} />;
}

/**
 * A cheer from someone in the home (migration 7000): the same slim line over the tab bar,
 * "Omar sent you a cheer", and behind it the words. No confetti: it is a person speaking, not
 * a prize. Opening it is reading it, so that marks it seen, on every phone; the x is "not
 * now" and marks nothing, so a cheer is never lost unread. "Lovely" brings the next one.
 */
function CheerMoment({ cheer, more, startOpen, today, timezone, onOpen, onNext, onLater }: { cheer: Cheer; more: number; startOpen: boolean; today: string; timezone: string; onOpen: () => void; onNext: () => void; onLater: () => void }) {
  const [open, setOpen] = useState(startOpen);
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => setHost(document.body), []);
  useEffect(() => {
    if (open) return;
    const t = setTimeout(onLater, 12_000);
    return () => clearTimeout(t);
  }, [open, onLater]);
  useEffect(() => {
    if (!open) return;
    buzz([18, 40, 18]);
    // A Supabase query only runs once it is awaited or then-ed.
    supabaseBrowser()
      .rpc("cheers_seen", { p_ids: [cheer.id] })
      .then(
        () => undefined,
        () => undefined,
      );
  }, [open, cheer.id]);
  if (!host) return null;
  const medal = cheer.about === "medal" && cheer.badge && cheer.tier != null ? { t: track(cheer.badge), x: tierOf(cheer.badge, cheer.tier) } : null;

  if (!open)
    return createPortal(
      <div className="celebrate-peek">
        <button
          type="button"
          className="celebrate-peek-open"
          onClick={() => {
            setOpen(true);
            onOpen();
          }}
        >
          <span className="cheer-heart" aria-hidden="true">
            <Icon name="heart" size={18} />
          </span>
          <span className="truncate">{cheer.from_name} sent you a cheer</span>
          <span aria-hidden="true">›</span>
        </button>
        <button type="button" className="celebrate-peek-close" aria-label="Not now" onClick={onLater}>
          ×
        </button>
      </div>,
      host,
    );

  return createPortal(
    <div className="celebrate" role="dialog" aria-modal="true" aria-labelledby="cheer-words" onClick={onNext}>
      <div className="celebrate-card" onClick={(e) => e.stopPropagation()}>
        {medal?.t && medal.x ? (
          <span className="celebrate-medal">
            <Medal metal={medal.x.metal} icon={medal.t.icon} size={96} label={`${medal.x.name} medal`} />
          </span>
        ) : (
          <span className="cheer-heart cheer-heart-big" aria-hidden="true">
            <Icon name="heart" size={34} />
          </span>
        )}
        <p className="muted text-sm font-semibold uppercase tracking-wider">A cheer from {cheer.from_name}</p>
        <h2 id="cheer-words" className="cheer-words">
          {cheer.words}
        </h2>
        <p className="muted">for {cheerFor(cheer, today, timezone)}</p>
        {more > 0 && <p className="muted text-sm">and {more} more</p>}
        <button type="button" className="btn btn-primary mt-2 w-full" onClick={onNext} autoFocus>
          Lovely
        </button>
      </div>
    </div>,
    host,
  );
}

function MedalMoment({ fresh }: { fresh: FreshBadge[] }) {
  const [open, setOpen] = useState(false);
  const [peek, setPeek] = useState(fresh.length > 0);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const top = fresh[0];

  useEffect(() => setHost(document.body), []);
  useEffect(() => {
    if (!peek || open) return;
    const t = setTimeout(() => setPeek(false), 12_000);
    return () => clearTimeout(t);
  }, [peek, open]);
  useEffect(() => {
    if (!open || !host) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    try {
      if (!still) navigator.vibrate?.([40, 60, 40, 60, 120]);
    } catch {
      /* no vibration on this phone */
    }
    const c = canvas.current;
    if (still || !c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = innerWidth * dpr;
    c.height = innerHeight * dpr;
    ctx.scale(dpr, dpr);
    // One burst from just above the medal, falling under gravity, gone in about two seconds.
    const cx = innerWidth / 2;
    const cy = innerHeight * 0.36;
    const bits = Array.from({ length: 140 }, () => {
      const a = Math.random() * Math.PI * 2;
      const v = 4 + Math.random() * 9;
      return { x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 4, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4, w: 6 + Math.random() * 6, h: 3 + Math.random() * 4, c: COLOURS[Math.floor(Math.random() * COLOURS.length)] };
    });
    let frame = 0;
    let raf = 0;
    const draw = () => {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (const b of bits) {
        b.vy += 0.25;
        b.vx *= 0.985;
        b.x += b.vx;
        b.y += b.vy;
        b.r += b.vr;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - frame / 130);
        ctx.translate(b.x, b.y);
        ctx.rotate(b.r);
        ctx.fillStyle = b.c;
        ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
        ctx.restore();
      }
      if (++frame < 130) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [open, host]);

  if (!(open || peek) || !host || !top) return null;
  const t = track(top.badge);
  const x = tierOf(top.badge, top.tier);
  if (!t || !x) return null;
  const { title, line } = headline(top.badge, top.tier);
  const more = fresh.length - 1;

  const close = () => {
    setOpen(false);
    setPeek(false);
    // A Supabase query only runs once it is awaited or then-ed: "void" alone would never send it.
    supabaseBrowser()
      .rpc("achievements_seen", { p_ids: fresh.map((f) => f.id) })
      .then(
        () => undefined,
        () => undefined,
      );
  };

  if (!open)
    return createPortal(
      <div className="celebrate-peek">
        <button type="button" className="celebrate-peek-open" onClick={() => setOpen(true)}>
          <Medal metal={x.metal} icon={t.icon} size={32} label="" />
          <span className="truncate">{t.family ? "The family won" : "You won"} {title.replace(/!$/, "")}</span>
          <span aria-hidden="true">›</span>
        </button>
        {/* "Not now" is not "never": the line steps aside for this visit and nothing is marked seen,
            as a cheer's x does (until 26 November this x marked every new medal seen for good). */}
        <button type="button" className="celebrate-peek-close" aria-label="Not now" onClick={() => setPeek(false)}>
          ×
        </button>
      </div>,
      host,
    );

  return createPortal(
    <div className="celebrate" role="dialog" aria-modal="true" aria-labelledby="celebrate-title" onClick={close}>
      <canvas ref={canvas} className="celebrate-confetti" aria-hidden="true" />
      <div className="celebrate-card" onClick={(e) => e.stopPropagation()}>
        <span className="celebrate-medal">
          <Medal metal={x.metal} icon={t.icon} size={132} label={`${x.name} medal`} />
        </span>
        <p className="muted text-sm font-semibold uppercase tracking-wider">{t.family ? "The family won" : top.mine ? "You won" : "Won"} · {t.title}</p>
        <h2 id="celebrate-title" className="celebrate-title">{title}</h2>
        <p className="text-lg">{line}</p>
        {more > 0 && <p className="muted text-sm">and {more} more on your shelf</p>}
        <div className="mt-2 grid w-full grid-cols-2 gap-2">
          <Link prefetch={false} href="/achievements" className="btn" onClick={close}>
            See the shelf
          </Link>
          <button type="button" className="btn btn-primary" onClick={close} autoFocus>
            Lovely
          </button>
        </div>
      </div>
    </div>,
    host,
  );
}
