export function NotConfigured() {
  return (
    <main className="mx-auto max-w-md p-6 pt-16">
      <div className="card">
        <h1 className="mb-2 text-2xl font-bold">Not connected yet</h1>
        <p className="muted">
          This app is deployed but not yet pointed at its database. Set these two environment variables and redeploy:
        </p>
        <pre className="mt-4 overflow-x-auto rounded-xl bg-[var(--card-2)] p-3 text-sm">
          NEXT_PUBLIC_SUPABASE_URL{"\n"}NEXT_PUBLIC_SUPABASE_ANON_KEY
        </pre>
        <p className="muted mt-4 text-sm">See family/README.md, section 2 “App (Vercel)”.</p>
      </div>
    </main>
  );
}
