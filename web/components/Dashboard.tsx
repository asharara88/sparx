'use client';

import { useCallback, useEffect, useState } from 'react';

interface Provider { key: string; env: string; configured: boolean }
interface Episode {
  episode_id: string; status: string; niche: string | null; host_mode: string;
  spent_usd: number; updated_at: string; hasVideo: boolean;
}

export default function Dashboard() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [configured, setConfigured] = useState(true);
  const [preview, setPreview] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // run form state
  const [mode, setMode] = useState<'demo' | 'pipeline'>('demo');
  const [topic, setTopic] = useState('Three AI tools every creator should try');
  const [sections, setSections] = useState(3);
  const [demoMode, setDemoMode] = useState<'auto' | 'avatar' | 'voiceover'>('auto');
  const [autoApprove, setAutoApprove] = useState(true);

  const loadEpisodes = useCallback(async () => {
    try {
      const r = await fetch('/api/episodes', { cache: 'no-store' });
      const j = await r.json();
      setConfigured(j.configured);
      setEpisodes(j.episodes ?? []);
    } catch { /* ignore transient */ }
  }, []);

  useEffect(() => {
    fetch('/api/providers').then((r) => r.json()).then((j) => setProviders(j.providers ?? [])).catch(() => {});
    loadEpisodes();
    const t = setInterval(loadEpisodes, 5000);
    return () => clearInterval(t);
  }, [loadEpisodes]);

  async function startRun() {
    setBusy(true);
    setToast(null);
    try {
      const body = mode === 'demo'
        ? { mode, topic, sections, demoMode: demoMode === 'auto' ? undefined : demoMode }
        : { mode, autoApprove };
      const r = await fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (j.started) {
        setToast(mode === 'demo'
          ? `Demo render started (pid ${j.pid}). It appears below as “demo” when cut.mp4 is ready — usually under a minute for voiceover, longer for avatar.`
          : `Pipeline started (pid ${j.pid}). Watch the episode status update below.`);
        setTimeout(loadEpisodes, 1500);
      } else {
        setToast('Failed to start run.');
      }
    } catch (e) {
      setToast('Failed to start run: ' + String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!configured && (
        <div className="banner">
          Supabase isn’t configured, so the episode list is empty. Add <code>SUPABASE_URL</code> and a
          key to the repo-root <code>.env</code>. Demo renders still work and appear below.
        </div>
      )}

      <div className="grid cols">
        {/* Run controls */}
        <div className="card">
          <h2>New run</h2>
          <div className="seg">
            <button className={mode === 'demo' ? '' : 'off'} onClick={() => setMode('demo')} type="button">Demo video</button>
            <button className={mode === 'pipeline' ? '' : 'off'} onClick={() => setMode('pipeline')} type="button">Full pipeline</button>
          </div>

          {mode === 'demo' ? (
            <>
              <label>Topic</label>
              <input type="text" value={topic} onChange={(e) => setTopic(e.target.value)} />
              <div className="row">
                <div>
                  <label>Sections</label>
                  <select value={sections} onChange={(e) => setSections(Number(e.target.value))}>
                    {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div>
                  <label>Voice</label>
                  <select value={demoMode} onChange={(e) => setDemoMode(e.target.value as typeof demoMode)}>
                    <option value="auto">Auto (HeyGen if keyed)</option>
                    <option value="avatar">HeyGen avatar</option>
                    <option value="voiceover">ElevenLabs / silent</option>
                  </select>
                </div>
              </div>
            </>
          ) : (
            <>
              <label>Gates</label>
              <select value={autoApprove ? 'auto' : 'manual'} onChange={(e) => setAutoApprove(e.target.value === 'auto')}>
                <option value="auto">Auto-approve (run to the end)</option>
                <option value="manual">Hold at review gates</option>
              </select>
              <p className="note">Runs the full research → script → media → render → QA → publish pipeline.</p>
            </>
          )}

          <button onClick={startRun} disabled={busy} type="button">
            {busy ? <><span className="spin" />Starting…</> : mode === 'demo' ? 'Render demo' : 'Start pipeline'}
          </button>
          {toast && <div className="toast">{toast}</div>}
        </div>

        {/* Provider status */}
        <div className="card">
          <h2>Providers</h2>
          <div className="providers">
            {providers.map((p) => (
              <span className="chip" key={p.env} title={p.env}>
                <span className={`dot ${p.configured ? 'on' : 'off'}`} />
                {p.key}
              </span>
            ))}
            {providers.length === 0 && <span className="empty">loading…</span>}
          </div>
          <p className="note">Green = key present in <code>.env</code>. Blank keys fall back to mocks.</p>
        </div>
      </div>

      {/* Episodes */}
      <div className="card" style={{ marginTop: 20 }}>
        <h2>Episodes</h2>
        {episodes.length === 0 ? (
          <p className="empty">No episodes yet. Start a run above.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Episode</th><th>Status</th><th>Niche</th><th>Spent</th><th>Updated</th><th></th></tr>
            </thead>
            <tbody>
              {episodes.map((e) => (
                <tr key={e.episode_id}>
                  <td className="mono">{e.episode_id}</td>
                  <td><span className={`status ${e.status}`}>{e.status}</span></td>
                  <td>{e.niche ?? '—'}</td>
                  <td>${Number(e.spent_usd).toFixed(2)}</td>
                  <td className="mono">{new Date(e.updated_at).toLocaleString()}</td>
                  <td>{e.hasVideo
                    ? <a className="play" onClick={() => setPreview(e.episode_id)} style={{ cursor: 'pointer' }}>▶ preview</a>
                    : <span className="empty">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Video preview */}
      <div className="card" style={{ marginTop: 20 }}>
        <h2>Preview</h2>
        <div className="row" style={{ marginBottom: 4 }}>
          <button className="ghost" type="button" onClick={() => setPreview('demo')} style={{ marginTop: 0 }}>Latest demo (generated/demo)</button>
          {preview && <button className="ghost" type="button" onClick={() => setPreview(null)} style={{ marginTop: 0 }}>Clear</button>}
        </div>
        {preview
          ? <video key={preview} controls src={`/api/video/${encodeURIComponent(preview)}`} />
          : <p className="empty">Pick an episode’s “preview”, or load the latest demo.</p>}
      </div>
    </>
  );
}
