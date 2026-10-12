import { redirect } from "next/navigation";
import { isConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { Me, RpcError } from "@/lib/types";
import { MeProvider } from "@/lib/me-context";
import { Nav } from "@/components/Nav";
import { NotConfigured } from "@/components/NotConfigured";
import { SignOutButton } from "@/components/SignOutButton";
import { OfflineFlusher } from "@/components/OfflineFlusher";
import { PreviewBanner } from "@/components/PreviewBanner";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!isConfigured()) return <NotConfigured />;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const { data, error } = await supabase.rpc("me");
  const me = data as Me | RpcError | null;

  if (error || !me || !me.ok) {
    return (
      <main className="mx-auto max-w-md p-6 pt-16">
        <div className="card">
          <h1 className="mb-2 text-2xl font-bold">Almost there</h1>
          <p>
            {me && !me.ok
              ? me.message
              : "We could not load your details. Check your connection and try again."}
          </p>
          <p className="muted mt-2 text-sm">Signed in as {auth.user.email}</p>
          <div className="mt-6">
            <SignOutButton />
          </div>
        </div>
      </main>
    );
  }

  const large = me.role.id !== "admin";
  return (
    <MeProvider me={me}>
      <div data-size={large ? "large" : undefined} className="mx-auto flex min-h-dvh max-w-2xl flex-col">
        {me.preview && <PreviewBanner name={me.member.display_name} role={me.role.label} />}
        <main className="flex-1 p-4 pb-28">{children}</main>
        <Nav />
        <OfflineFlusher />
      </div>
    </MeProvider>
  );
}
