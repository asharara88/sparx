import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Me } from "@/lib/types";
import { PrefsForm } from "@/components/PrefsForm";
import { NightPref } from "@/components/NightPref";
import { PageHeader } from "@/components/PageHeader";
import { nightWindow } from "@/lib/night";

export const dynamic = "force-dynamic";

/** Language, the simple screen, large text and the dark screen at night: this phone's display. */
export default async function DisplayPage() {
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me | null;
  if (!me?.ok) redirect("/");
  const night = nightWindow(me.subjects?.[0] ?? null);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/me" title="Language and display" />
      <PrefsForm lang={me.member.lang ?? "en"} simple={!!me.member.simple_mode} large={me.member.large_text ?? me.role.id !== "admin"} />
      <div className="card">
        <NightPref from={night.from} to={night.to} />
      </div>
    </div>
  );
}
