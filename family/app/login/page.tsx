import { redirect } from "next/navigation";
import { isConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "./LoginForm";
import { NotConfigured } from "@/components/NotConfigured";
import { HashSession } from "@/components/HashSession";
import { Mark, Name, NameArabic } from "@/components/Brand";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; mode?: string }> }) {
  if (!isConfigured()) return <NotConfigured />;
  const supabase = await createClient();
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
          <h1 className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <Name className="text-5xl" />
            <NameArabic className="text-4xl" />
          </h1>
          <p className="muted mt-2">The little one&apos;s day, in everyone&apos;s hands.</p>
        </div>
      </div>
      <div className="card">
        {error && (
          <p className="notice notice-danger mb-4" role="alert">
            {error === "link" ? "That link did not work. It may be old. Ask for a new one." : error}
          </p>
        )}
        <LoginForm initialMode={initialMode} />
      </div>
    </main>
  );
}
