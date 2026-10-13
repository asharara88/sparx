"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMe } from "@/lib/me-context";
import { can } from "@/lib/types";
import { Icon, type IconName } from "@/components/Icon";

/** Home, Lana, Milk, Calendar, Chat, More. Shopping, Fanta, the house and admin screens live under More. */
export function Nav() {
  const me = useMe();
  const path = usePathname();
  const staff = !can(me, "lana", "view") && can(me, "shopping_requests", "add");
  const items: { href: string; label: string; icon: IconName }[] = [];
  if (staff) {
    items.push({ href: "/send", label: "Send", icon: "camera" });
    if (can(me, "maintenance", "view")) items.push({ href: "/house", label: "House", icon: "house" });
    if (can(me, "calendar", "view")) items.push({ href: "/calendar", label: "Calendar", icon: "calendar" });
    if (can(me, "chat", "view")) items.push({ href: "/chat", label: "Chat", icon: "chat" });
  } else {
    items.push({ href: "/", label: "Home", icon: "home" });
    if (can(me, "lana", "view")) items.push({ href: "/lana", label: "Lana", icon: "baby" });
    if (can(me, "lana", "view") && !me.member.simple_mode) items.push({ href: "/lana/milk", label: "Milk", icon: "droplet" });
    if (can(me, "calendar", "view")) items.push({ href: "/calendar", label: "Calendar", icon: "calendar" });
    if (can(me, "chat", "view")) items.push({ href: "/chat", label: "Chat", icon: "chat" });
  }
  items.push({ href: "/me", label: "More", icon: "grid" });

  return (
    <nav aria-label="Main" className="tabbar">
      <ul style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
        {items.map((it) => {
          const active = it.href === "/" ? path === "/" : it.href === "/lana" ? path.startsWith("/lana") && !path.startsWith("/lana/milk") : path.startsWith(it.href);
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
