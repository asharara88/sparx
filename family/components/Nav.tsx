"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMe } from "@/lib/me-context";
import { can } from "@/lib/types";
import { childName } from "@/lib/names";
import { Icon, type IconName } from "@/components/Icon";

/**
 * Home, the child, ＋, Milk, More (DESIGN.md, "The bottom bar"): the ＋ in the middle opens
 * the log sheet from any screen, as in Huckleberry; Chat, Calendar and the admin screens
 * live under More. Someone without the child's log gets Today, Calendar, Chat.
 */
export function Nav() {
  const me = useMe();
  const path = usePathname();
  const staff = !can(me, "lana", "view");
  const items: { href: string; label: string; icon: IconName; log?: boolean }[] = [];
  if (staff) {
    items.push({ href: "/send", label: "Today", icon: "home" });
    if (can(me, "calendar", "view")) items.push({ href: "/calendar", label: "Calendar", icon: "calendar" });
    if (can(me, "chat", "view")) items.push({ href: "/chat", label: "Chat", icon: "chat" });
  } else {
    items.push({ href: "/", label: "Home", icon: "home" });
    if (can(me, "lana", "view")) items.push({ href: "/baby", label: childName(me), icon: "baby" });
    if (can(me, "lana", "add")) items.push({ href: "/baby?log=1", label: "Log", icon: "plus", log: true });
    if (can(me, "lana", "view") && !me.member.simple_mode) items.push({ href: "/baby/milk", label: "Milk", icon: "droplet" });
  }
  items.push({ href: "/me", label: "More", icon: "grid" });

  return (
    <nav aria-label="Main" className="tabbar">
      <ul style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
        {items.map((it) => {
          // More stays lit on the screens it opens (Chat, Calendar, Notes, Members, the helper's pages).
          const underMore = !staff && ["/chat", "/calendar", "/notes", "/members", "/audit", "/ask"].some((p) => path.startsWith(p));
          const active = it.log ? false : it.href === "/" ? path === "/" : it.href === "/baby" ? path.startsWith("/baby") && !path.startsWith("/baby/milk") : it.href === "/me" ? path.startsWith("/me") || underMore : path.startsWith(it.href);
          if (it.log)
            return (
              <li key={it.href}>
                <Link href={it.href} className="tab tab-log" aria-label="Log something">
                  <span className="tab-log-disc">
                    <Icon name="plus" size={28} strokeWidth={2.4} />
                  </span>
                </Link>
              </li>
            );
          return (
            <li key={it.href}>
              <Link href={it.href} aria-current={active ? "page" : undefined} className="tab">
                <Icon name={it.icon} size={24} strokeWidth={active ? 2.25 : 1.75} />
                <span>{it.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
