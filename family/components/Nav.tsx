"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMe } from "@/lib/me-context";
import { can } from "@/lib/types";

export function Nav() {
  const me = useMe();
  const path = usePathname();
  const items: { href: string; label: string; icon: string }[] = [{ href: "/", label: "Home", icon: "🏠" }];
  if (can(me, "lana", "view")) items.push({ href: "/lana", label: "Lana", icon: "👶" });
  if (can(me, "members", "edit")) items.push({ href: "/members", label: "Members", icon: "👪" });
  items.push({ href: "/me", label: "Me", icon: "🙂" });

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 mx-auto max-w-2xl border-t-2 border-[var(--line)] bg-[var(--card)] pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
        {items.map((it) => {
          const active = it.href === "/" ? path === "/" : path.startsWith(it.href);
          return (
            <li key={it.href}>
              <Link
                href={it.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-[64px] flex-col items-center justify-center gap-0.5 text-sm font-semibold ${
                  active ? "text-[var(--accent)]" : "text-[var(--muted)]"
                }`}
              >
                <span aria-hidden className="text-2xl leading-none">
                  {it.icon}
                </span>
                {it.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
