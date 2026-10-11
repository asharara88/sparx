"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMe } from "@/lib/me-context";
import { can } from "@/lib/types";

/** Floating "Ask" button on every screen, for members with the assistant switched on. */
export function AskButton() {
  const me = useMe();
  const path = usePathname();
  if (!can(me, "assistant", "view") || path.startsWith("/ask")) return null;
  return (
    <Link
      href="/ask"
      aria-label="Ask the assistant"
      className="fixed bottom-[calc(72px+env(safe-area-inset-bottom))] right-4 z-10 flex h-16 w-16 items-center justify-center rounded-full border-2 border-[var(--accent)] bg-[var(--accent)] text-3xl text-[var(--accent-fg)] shadow-lg"
    >
      💬
    </Link>
  );
}
