import { redirect } from "next/navigation";
import { isConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "./LoginForm";
import { NotConfigured } from "@/components/NotConfigured";
import { HashSession } from "@/components/HashSession";
import { Mark, Name } from "@/components/Brand";
import { WelcomeBack } from "@/components/WelcomeBack";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; mode?: string }> }) {
  if (!isConfigured()) return <NotConfigured />;
  // The admin's own session decides whether they are signed in, never a "view as" token.
  const supabase = await createClient({ ignorePreview: true });
  const { data } = await supabase.auth.getUser();
  if (data.user) redirect("/");
  const { error, mode } = await searchParams;
  const initialMode = mode === "signup" || mode === "forgot" || mode === "link" ? mode : "signin";
  return (
    <main className="mx-auto max-w-md p-6 pt-16">
      <HashSession />
      <div className="mb-8 flex flex-col items-start gap-3">
        <Mark size={64} />
        <div>
          <h1>
            <Name className="text-6xl" />
          </h1>
          <p className="tagline mt-1 text-2xl">Care, together.</p>
          <p className="muted mt-1">A shared view of your baby&apos;s day.</p>
          <WelcomeBack />
        </div>
      </div>
      <div className="card">
        {error && (
          <p className="notice notice-danger mb-4" role="alert">
            {error === "link" ? "That link did not work. It may be old. Ask for a new one." : error === "google_off" ? "Google sign-in is not switched on yet. Use your e-mail for now." : error}
          </p>
        )}
        <LoginForm initialMode={initialMode} />
      </div>
    </main>
  );
}
