import { redirect } from "next/navigation";
import { isConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "./LoginForm";
import { NotConfigured } from "@/components/NotConfigured";

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
      <div className="mb-8 flex items-center gap-3">
        <img src="/icons/icon-192.png" alt="" width={56} height={56} className="rounded-2xl" />
        <h1 className="text-3xl font-bold">Our home</h1>
      </div>
      <div className="card">
        {error && (
          <p className="mb-4 rounded-xl border-2 border-red-700 p-3 text-red-800" role="alert">
            {error === "link" ? "That link did not work. It may be old. Ask for a new one." : error}
          </p>
        )}
        <LoginForm initialMode={initialMode} />
      </div>
    </main>
  );
}
