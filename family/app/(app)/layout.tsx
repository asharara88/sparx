import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { isConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { PREVIEW_COOKIE } from "@/lib/server/preview";
import type { Me, RpcError } from "@/lib/types";
import { MeProvider } from "@/lib/me-context";
import { Nav } from "@/components/Nav";
import { NotConfigured } from "@/components/NotConfigured";
import { SignOutButton } from "@/components/SignOutButton";
import { CreateHome } from "@/components/CreateHome";
import { HomeSwitcher } from "@/components/HomeSwitcher";
import { OfflineFlusher } from "@/components/OfflineFlusher";
import { PreviewBanner } from "@/components/PreviewBanner";
import { BindHome } from "@/components/RememberHome";
import { NightScreen } from "@/components/NightScreen";
import { nightWindow } from "@/lib/night";
import { meOnce } from "@/lib/server/me";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!isConfigured()) return <NotConfigured />;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    // A "view as" token the database no longer accepts must not look like a sign-out:
    // end the preview and come back as the admin.
    if ((await cookies()).get(PREVIEW_COOKIE)?.value) redirect("/api/view-as/exit");
    redirect("/login");
  }

  const { data, error } = await meOnce();
  const me = data as Me | RpcError | null;

  // In no home yet: make one, or wait to be added (docs/MULTI_HOME.md).
  if (me && !me.ok && me.error === "no_member") return <CreateHome email={auth.user.email ?? null} />;

  // This device was showing a home the account is no longer in (removed, or deleted):
  // nothing runs as it; pick one of the others (the switch binds the device to it).
  if (me && !me.ok && me.error === "not_in_home") {
    return (
      <main className="mx-auto max-w-md p-6 pt-16">
        <div className="card">
          <h1 className="mb-2 text-2xl font-bold">Not in that home any more</h1>
          <p>{me.message}</p>
          <div className="mt-4">
            <HomeSwitcher homes={me.homes ?? []} recover />
          </div>
          <p className="muted mt-2 text-sm">Signed in as {auth.user.email}</p>
          <div className="mt-6">
            <SignOutButton />
          </div>
        </div>
      </main>
    );
  }

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

  const large = me.member.large_text ?? me.role.id !== "admin";
  // The first child's night is the home's night: the screen goes very dark during it.
  const night = nightWindow(me.subjects?.[0] ?? null);
  return (
    <MeProvider me={me}>
      <div data-size={large ? "large" : undefined} className="mx-auto flex min-h-dvh max-w-2xl flex-col">
        {me.preview && <PreviewBanner name={me.member.display_name} role={me.role.label} />}
        <main className="flex-1">{children}</main>
        <Nav />
        <OfflineFlusher />
        <NightScreen from={night.from} to={night.to} timezone={me.household.timezone} />
        {!me.preview && <BindHome id={me.household.id} name={me.household.name} />}
      </div>
    </MeProvider>
  );
}
