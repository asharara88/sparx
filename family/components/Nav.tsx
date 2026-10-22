"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMe } from "@/lib/me-context";
import { can } from "@/lib/types";
import { childName } from "@/lib/names";
import { Icon, type IconName } from "@/components/Icon";

/** Home, the child, Milk, Calendar, Chat, More. The admin screens live under More. Someone without the child's log gets Today, Calendar, Chat. */
export function Nav() {
  const me = useMe();
  const path = usePathname();
  const staff = !can(me, "lana", "view");
  const items: { href: string; label: string; icon: IconName }[] = [];
  if (staff) {
    items.push({ href: "/send", label: "Today", icon: "home" });
    if (can(me, "calendar", "view")) items.push({ href: "/calendar", label: "Calendar", icon: "calendar" });
    if (can(me, "chat", "view")) items.push({ href: "/chat", label: "Chat", icon: "chat" });
  } else {
    items.push({ href: "/", label: "Home", icon: "home" });
    if (can(me, "lana", "view")) items.push({ href: "/baby", label: childName(me), icon: "baby" });
    if (can(me, "lana", "view") && !me.member.simple_mode) items.push({ href: "/baby/milk", label: "Milk", icon: "droplet" });
    if (can(me, "calendar", "view")) items.push({ href: "/calendar", label: "Calendar", icon: "calendar" });
    if (can(me, "chat", "view")) items.push({ href: "/chat", label: "Chat", icon: "chat" });
  }
  items.push({ href: "/me", label: "More", icon: "grid" });

  return (
    <nav aria-label="Main" className="tabbar">
      <ul style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
        {items.map((it) => {
          const active = it.href === "/" ? path === "/" : it.href === "/baby" ? path.startsWith("/baby") && !path.startsWith("/baby/milk") : path.startsWith(it.href);
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
