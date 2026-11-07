import { redirect } from "next/navigation";
import type { Me } from "@/lib/types";
import { meOnce } from "@/lib/server/me";

/**
 * The dashboard is Home now (Mido, 7 November): sleep, feeds, food and pumping sit below the
 * log rows. The simple screen has no such part, so a member on it goes to the child's Today
 * (the day's numbers and Sleep today) instead.
 */
export default async function DashboardPage() {
  const { data } = await meOnce();
  const me = data as Me | null;
  redirect(me?.ok && me.member.simple_mode ? "/baby?tab=today" : "/#today");
}
