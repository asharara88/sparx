import { isConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { inviteToken } from "@/lib/join";
import { NotConfigured } from "@/components/NotConfigured";
import { HashSession } from "@/components/HashSession";
import { Mark, Name } from "@/components/Brand";
import { JoinScreen, type Invite } from "@/components/JoinScreen";

export const dynamic = "force-dynamic";

/**
 * An invite link: the home and the name waiting for whoever opens it, with sign-in on
 * the same screen when they are signed out, and one tap to join when they are in.
 */
export default async function JoinPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string }> }) {
  if (!isConfigured()) return <NotConfigured />;
  const token = inviteToken((await params).token);
  const { error } = await searchParams;
  // The admin's own session decides who is looking, never a "view as" token.
  const supabase = await createClient({ ignorePreview: true });
  const { data: auth } = await supabase.auth.getUser();
  const { data } = token ? await supabase.rpc("member_invite_peek", { p_token: token }) : { data: null };
  const invite = (data as Invite | { ok: false } | null)?.ok ? (data as Invite) : null;
  return (
    <main className="mx-auto max-w-md p-6 pt-12">
      <HashSession />
      <div className="mb-6 flex items-center gap-3">
        <Mark size={44} />
        <h1>
          <Name className="text-4xl" />
        </h1>
      </div>
      <JoinScreen token={token} invite={invite} email={auth.user?.email ?? null} error={error === "google_off" || error === "google" || error === "link" ? error : null} />
    </main>
  );
}
