import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { HomeListing, Me } from "@/lib/types";
import { HomeSwitcher } from "@/components/HomeSwitcher";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

/** The homes this account is in, switching between them, and starting another. */
export default async function MyHomesPage() {
  const supabase = await createClient();
  const { data: meData } = await supabase.rpc("me");
  const me = meData as Me | null;
  if (!me?.ok || me.preview) redirect("/me");
  const { data } = await supabase.rpc("my_homes");
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/me" title="Your homes" />
      <HomeSwitcher homes={(data as HomeListing[] | null) ?? []} />
    </div>
  );
}
