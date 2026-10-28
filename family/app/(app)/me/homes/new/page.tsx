import { createClient } from "@/lib/supabase/server";
import type { Me, RpcError } from "@/lib/types";
import { CreateHome } from "@/components/CreateHome";
import { meOnce } from "@/lib/server/me";

export const dynamic = "force-dynamic";

/** A member making a second home. The account runs as it from then on; the switcher on the Me screen goes back. */
export default async function NewHomePage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const { data } = await meOnce();
  const me = data as Me | RpcError | null;
  if (me && me.ok && me.preview) {
    return <p className="notice">Not while viewing the app as someone else.</p>;
  }
  return <CreateHome email={auth.user?.email ?? null} another />;
}
