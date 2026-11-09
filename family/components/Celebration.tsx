"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { headline, tierOf, track } from "@/lib/achievements";
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
 */
export function Celebration({ fresh }: { fresh: FreshBadge[] }) {
  const [open, setOpen] = useState(fresh.length > 0);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const top = fresh[0];

  useEffect(() => setHost(document.body), []);
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

  if (!open || !host || !top) return null;
  const t = track(top.badge);
  const x = tierOf(top.badge, top.tier);
  if (!t || !x) return null;
  const { title, line } = headline(top.badge, top.tier);
  const more = fresh.length - 1;

  const close = () => {
    setOpen(false);
    // A Supabase query only runs once it is awaited or then-ed: "void" alone would never send it.
    supabaseBrowser()
      .rpc("achievements_seen", { p_ids: fresh.map((f) => f.id) })
      .then(
        () => undefined,
        () => undefined,
      );
  };

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
