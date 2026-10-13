"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";

/** Your photo at the top of Home. Tap it for Me and Sign out. */
export function ProfileMenu({ name, path }: { name: string; path?: string | null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label="Your menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="rounded-full">
        <Avatar name={name} path={path} size={44} />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-44 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)] shadow-[var(--shadow)]">
          <Link href="/me" className="flex items-center gap-2 px-4 py-3 font-semibold" onClick={() => setOpen(false)}>
            <Icon name="user" size={18} /> {name}
          </Link>
          <form action="/auth/signout" method="post">
            <button type="submit" className="flex w-full items-center gap-2 px-4 py-3 text-left font-semibold">
              <Icon name="logout" size={18} /> Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
