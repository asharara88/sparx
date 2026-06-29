'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface Provider { key: string; env: string; configured: boolean }
interface AvatarOption { id: string; label: string }
interface Episode {
  episode_id: string; status: string; niche: string | null; host_mode: string;
  spent_usd: number; updated_at: string; hasVideo: boolean;
}

export default function Dashboard() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [configured, setConfigured] = useState(true);
  const [preview, setPreview] = useState<string | null>(null);
  const [videoBust, setVideoBust] = useState<number>(0);
  const [busy, setBusy] = useState(false);

  // live run progress
  const [runLog, setRunLog] = useState<string | null>(null);
  const [runTail, setRunTail] = useState('');
  const [runState, setRunState] = useState<'idle' | 'running' | 'done' | 'failed'>('idle');
  const tailRef = useRef<HTMLPreElement>(null);

  // run form state
  const [mode, setMode] = useState<'demo' | 'pipeline'>('demo');
  const [topic, setTopic] = useState('Three AI tools every creator should try');
  const [sections, setSections] = useState(3);
  const [demoMode, setDemoMode] = useState<'auto' | 'avatar' | 'voiceover'>('auto');
  const [autoApprove, setAutoApprove] = useState(true);
  const [avatars, setAvatars] = useState<AvatarOption[]>([]);
  const [avatarId, setAvatarId] = useState('');

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
    fetch('/api/avatars').then((r) => r.json()).then((j) => { setAvatars(j.avatars ?? []); setAvatarId(j.defaultId ?? (j.avatars?.[0]?.id ?? '')); }).catch(() => {});
    loadEpisodes();
    const t = setInterval(loadEpisodes, 5000);
    return () => clearInterval(t);
  }, [loadEpisodes]);

  // Poll the active run's log for live progress + completion.
  useEffect(() => {
    if (!runLog || runState === 'done' || runState === 'failed') return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch(`/api/run-status?log=${encodeURIComponent(runLog)}`, { cache: 'no-store' });
        const j = await r.json();
        if (stop) return;
        setRunTail(j.tail || '');
        if (j.done) {
          setRunState(j.ok ? 'done' : 'failed');
          if (j.ok && mode === 'demo' && j.videoMtime) { setPreview('demo'); setVideoBust(j.videoMtime); }
          loadEpisodes();
        }
      } catch { /* keep polling */ }
    };
    tick();
    const t = setInterval(tick, 2000);
    return () => { stop = true; clearInterval(t); };
  }, [runLog, runState, mode, loadEpisodes]);

  useEffect(() => { if (tailRef.current) tailRef.current.scrollTop = tailRef.current.scrollHeight; }, [runTail]);

  async function startRun() {
    setBusy(true);
    setRunTail('');
    setRunState('idle');
    setRunLog(null);
    try {
      const body = mode === 'demo'
        ? { mode, topic, sections, demoMode: demoMode === 'auto' ? undefined : demoMode, avatarId }
        : { mode, autoApprove, avatarId };
      const r = await fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (j.started && j.log) {
        setRunLog(j.log);
        setRunState('running');
      } else {
        setRunState('failed');
        setRunTail('Failed to start run.');
      }
    } catch (e) {
      setRunState('failed');
      setRunTail('Failed to start run: ' + String(e));
    } finally {
      setBusy(false);
    }
  }

  const videoSrc = (id: string) => `/api/video/${encodeURIComponent(id)}${id === 'demo' && videoBust ? `?t=${videoBust}` : ''}`;

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
              {demoMode !== 'voiceover' && (
                <>
                  <label>Avatar</label>
                  <select value={avatarId} onChange={(e) => setAvatarId(e.target.value)}>
                    {avatars.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                  </select>
                </>
              )}
              <p className="note">Avatar mode calls HeyGen per section and can take a few minutes — watch progress below.</p>
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

          <button onClick={startRun} disabled={busy || runState === 'running'} type="button">
            {busy || runState === 'running' ? <><span className="spin" />Running…</> : mode === 'demo' ? 'Render demo' : 'Start pipeline'}
          </button>

          {runLog && (
            <div className="toast">
              <div style={{ marginBottom: 8, fontWeight: 600 }}>
                {runState === 'running' && <><span className="spin" />Working…</>}
                {runState === 'done' && '✅ Done — video loaded below.'}
                {runState === 'failed' && '⚠ Run failed — see log.'}
              </div>
              <pre ref={tailRef} className="logbox">{runTail || 'starting…'}</pre>
            </div>
          )}
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
                    ? <a className="play" onClick={() => { setPreview(e.episode_id); setVideoBust(0); }} style={{ cursor: 'pointer' }}>▶ preview</a>
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
          <button className="ghost" type="button" onClick={() => { setPreview('demo'); setVideoBust(Date.now()); }} style={{ marginTop: 0 }}>Latest demo</button>
          {preview && <button className="ghost" type="button" onClick={() => setPreview(null)} style={{ marginTop: 0 }}>Clear</button>}
        </div>
        {preview
          ? <video key={`${preview}-${videoBust}`} controls autoPlay src={videoSrc(preview)} />
          : <p className="empty">Pick an episode’s “preview”, or load the latest demo.</p>}
      </div>
    </>
  );
}
