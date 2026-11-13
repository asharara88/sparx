import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Me } from "@/lib/types";
import { PrefsForm } from "@/components/PrefsForm";
import { NightPref } from "@/components/NightPref";
import { PageHeader } from "@/components/PageHeader";
import { nightWindow } from "@/lib/night";
import { meOnce } from "@/lib/server/me";

export const dynamic = "force-dynamic";

/** Display: the language, then the simple screen, large text and the dark screen at night as one group of switches. */
export default async function DisplayPage() {
  const supabase = await createClient();
  const { data: meData } = await meOnce();
  const me = meData as Me | null;
  if (!me?.ok) redirect("/");
  const night = nightWindow(me.subjects?.[0] ?? null);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/me" title="Display" />
      <PrefsForm lang={me.member.lang ?? "en"} simple={!!me.member.simple_mode} large={me.member.large_text ?? me.role.id !== "admin"}>
        <NightPref from={night.from} to={night.to} />
      </PrefsForm>
    </div>
  );
}
