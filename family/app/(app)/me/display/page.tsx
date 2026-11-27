import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Me } from "@/lib/types";
import { PrefsForm } from "@/components/PrefsForm";
import { NightPref } from "@/components/NightPref";
import { PageHeader } from "@/components/PageHeader";
import { nightWindow } from "@/lib/night";
import { andList } from "@/lib/nights";
import { meOnce } from "@/lib/server/me";

export const dynamic = "force-dynamic";

/** Display: the language, then the simple screen, large text and the dark screen at night as one group of switches. */
export default async function DisplayPage() {
  const supabase = await createClient();
  const { data: meData } = await meOnce();
  const me = meData as Me | null;
  if (!me?.ok) redirect("/");
  const night = nightWindow(me.subjects?.[0] ?? null);
  // "Tell ... about my nights": for a parent with another parent in the home, or whenever she
  // has answered already. One call, for her own answer and their names; only she is told it
  // (migration 7000: it is not on her member row, which others may read).
  let nights: { on: boolean; names: string } | null = null;
  if (me.role.id === "admin") {
    const { data } = await supabase.rpc("me_night_share");
    const mine = data as { ok?: boolean; night_share?: boolean | null; parents?: string[] } | null;
    const others = mine?.ok ? (mine.parents ?? []) : [];
    if (mine?.ok && (others.length > 0 || mine.night_share != null)) nights = { on: mine.night_share === true, names: andList(others) || "the other parent" };
  }
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/me" title="Display" />
      <PrefsForm lang={me.member.lang ?? "en"} simple={!!me.member.simple_mode} large={me.member.large_text ?? me.role.id !== "admin"} nights={nights}>
        <NightPref from={night.from} to={night.to} />
      </PrefsForm>
    </div>
  );
}
