"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Loading from "@/app/(app)/loading";

type Swap = { pending: string | null; go: (href: string) => void };
const State = createContext<Swap>({ pending: null, go: () => {} });

/** Tell the page swap a tab was tapped: the skeleton shows at once, until the new page's URL is in place. */
export function usePageSwap() {
  return useContext(State).go;
}

/**
 * A tab answers at once (DESIGN.md, rule 9) without the server pre-rendering every tab
 * on every page: tapping one swaps the page for the loading skeleton immediately and the
 * new page replaces it when it arrives. Links do not prefetch (each prefetch is a full
 * server render with its own sign-in checks); this gives the same instant answer for one
 * request. A tap on the tab already shown does nothing; a navigation that never lands
 * (no signal) gives the page back after eight seconds.
 */
/** Around the whole app shell, tabs included; `PageSwap` below marks the slot the skeleton replaces. */
export function PageSwapProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const here = `${pathname}${search.size ? `?${search}` : ""}`;
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => setPending(null), [here]);
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setPending(null), 8000);
    return () => clearTimeout(t);
  }, [pending]);
  const go = useCallback(
    (href: string) => setPending((p) => (href === here ? p : href)),
    [here],
  );
  return <State.Provider value={{ pending, go }}>{children}</State.Provider>;
}

/** The page slot: the skeleton while a tapped tab's page is on its way, the page otherwise. */
export function PageSwap({ children }: { children: ReactNode }) {
  return useContext(State).pending ? <Loading /> : <>{children}</>;
}
