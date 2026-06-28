import Dashboard from '@/components/Dashboard';

export default function Page() {
  return (
    <main className="wrap">
      <header className="top">
        <h1>sparx</h1>
        <span className="tag">AI YouTube Studio</span>
      </header>
      <p className="sub">Trigger pipeline runs, watch episode state, and preview rendered cuts.</p>
      <Dashboard />
    </main>
  );
}
