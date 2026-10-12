"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMe } from "@/lib/me-context";
import { can } from "@/lib/types";
import { Icon, type IconName } from "@/components/Icon";

/** At most six tabs. Admin screens (Members, Audit) live under Me. Chat is for everyone. */
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
    if (can(me, "calendar", "view")) items.push({ href: "/calendar", label: "Calendar", icon: "calendar" });
    if (can(me, "shopping", "view")) items.push({ href: "/shopping", label: "Shopping", icon: "cart" });
    if (can(me, "chat", "view")) items.push({ href: "/chat", label: "Chat", icon: "chat" });
  }
  items.push({ href: "/me", label: "Me", icon: "user" });

  return (
    <nav aria-label="Main" className="tabbar">
      <ul style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
        {items.map((it) => {
          const active = it.href === "/" ? path === "/" : path.startsWith(it.href);
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
