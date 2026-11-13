import { createClient } from "@/lib/supabase/server";
import type { Me, RpcError } from "@/lib/types";
import { CreateHome } from "@/components/CreateHome";
import { PageHeader } from "@/components/PageHeader";
import { meOnce } from "@/lib/server/me";

export const dynamic = "force-dynamic";

/** A member making a second home. The account runs as it from then on; Your homes, under More, goes back. */
export default async function NewHomePage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const { data } = await meOnce();
  const me = data as Me | RpcError | null;
  if (me && me.ok && me.preview) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader back="/me/homes" title="Create another home" />
        <p className="notice">Not while viewing the app as someone else.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back="/me/homes" title="Create another home" subtitle="It starts empty; you stay in this one too." />
      <CreateHome email={auth.user?.email ?? null} name={me && me.ok ? me.member.display_name : undefined} another />
    </div>
  );
}
