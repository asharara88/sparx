'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

interface Provider { key: string; env: string; configured: boolean }
interface AvatarOption { id: string; label: string }
interface VoiceOption { id: string; label: string }
interface Episode {
  episode_id: string; status: string; niche: string | null; host_mode: string;
  spent_usd: number; updated_at: string; hasVideo: boolean;
}

type View = 'runs' | 'library' | 'preview' | 'setup';

const NAV: { id: View; label: string; icon: ReactElement }[] = [
  { id: 'runs', label: 'Runs', icon: <Icon d="M5 3l14 9-14 9V3z" /> },
  { id: 'library', label: 'Library', icon: <Icon d="M4 6h16M4 12h16M4 18h16" /> },
  { id: 'preview', label: 'Preview', icon: <Icon d="M2 6a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6zm15 4l5-3v10l-5-3" /> },
  { id: 'setup', label: 'Setup', icon: <Icon d="M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 008 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H2a2 2 0 110-4h.09A1.65 1.65 0 004.6 8a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 008.92 3.7 1.65 1.65 0 0010 2.19V2a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0020.3 8" /> },
];

function Icon({ d }: { d: string }) {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

export default function Dashboard() {
  const [view, setView] = useState<View>('runs');

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
  const [demoMode, setDemoMode] = useState<'auto' | 'avatar' | 'voiceover' | 'broll'>('auto');
  const [hostMode, setHostMode] = useState<'avatar' | 'voice_only'>('avatar');
  const [autoApprove, setAutoApprove] = useState(true);
  const [avatars, setAvatars] = useState<AvatarOption[]>([]);
  const [avatarId, setAvatarId] = useState('');
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [voiceId, setVoiceId] = useState('');
  const [runwayTakes, setRunwayTakes] = useState(1);
  const [music, setMusic] = useState(false);

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
    fetch('/api/voices').then((r) => r.json()).then((j) => { setVoices(j.voices ?? []); setVoiceId(j.defaultId ?? (j.voices?.[0]?.id ?? '')); }).catch(() => {});
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
      // Which engines actually consume each control:
      //  · ElevenLabs voice → voiceover + b-roll (demo) and voice_only (pipeline)
      //  · Runway takes      → b-roll (demo) and voice_only (pipeline)
      const usesVoice = mode === 'demo' ? (demoMode === 'voiceover' || demoMode === 'broll') : hostMode === 'voice_only';
      const usesRunway = mode === 'demo' ? demoMode === 'broll' : hostMode === 'voice_only';
      const body = mode === 'demo'
        ? { mode, topic, sections, demoMode: demoMode === 'auto' ? undefined : demoMode, avatarId, music, ...(usesVoice ? { voiceId } : {}), ...(usesRunway ? { runwayTakes } : {}) }
        : { mode, autoApprove, avatarId, hostMode, ...(usesVoice ? { voiceId } : {}), ...(usesRunway ? { runwayTakes } : {}) };
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

  // Open an episode (or the demo) in the Preview view.
  const openPreview = useCallback((id: string, bust = 0) => {
    setPreview(id);
    setVideoBust(bust);
    setView('preview');
  }, []);

  const providerHealth = useMemo(() => {
    const on = providers.filter((p) => p.configured).length;
    return { on, total: providers.length };
  }, [providers]);

  const withVideo = episodes.filter((e) => e.hasVideo).length;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">s</div>
          <div>
            <div className="brand-name">sparx</div>
            <div className="brand-sub">AI YouTube Studio</div>
          </div>
        </div>

        <nav className="nav">
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              className={`nav-item ${view === n.id ? 'active' : ''}`}
              onClick={() => setView(n.id)}
            >
              {n.icon}
              <span className="nav-label">{n.label}</span>
              {n.id === 'library' && episodes.length > 0 && <span className="nav-badge">{episodes.length}</span>}
              {n.id === 'runs' && runState === 'running' && <span className="nav-badge"><span className="spin" style={{ margin: 0 }} /></span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <button type="button" className="health" onClick={() => setView('setup')}>
            <span className={`dot ${providerHealth.on > 0 ? 'on' : 'off'}`} />
            <span className="health-label">
              <strong>{providerHealth.total ? `${providerHealth.on}/${providerHealth.total}` : '—'}</strong> providers keyed
            </span>
          </button>
        </div>
      </aside>

      <main className="main">
        {view === 'runs' && (
          <RunsView
            {...{ mode, setMode, topic, setTopic, sections, setSections, demoMode, setDemoMode, hostMode, setHostMode, autoApprove, setAutoApprove, avatars, avatarId, setAvatarId, voices, voiceId, setVoiceId, runwayTakes, setRunwayTakes, music, setMusic, busy, runState, runLog, runTail, tailRef, startRun }}
            onViewResult={() => setView('preview')}
          />
        )}

        {view === 'library' && (
          <LibraryView episodes={episodes} configured={configured} onPreview={openPreview} onNewRun={() => setView('runs')} />
        )}

        {view === 'preview' && (
          <PreviewView preview={preview} videoSrc={videoSrc} onLatestDemo={() => setPreview('demo')} onClear={() => setPreview(null)} setVideoBust={setVideoBust} onBrowse={() => setView('library')} />
        )}

        {view === 'setup' && (
          <SetupView providers={providers} />
        )}
      </main>
    </div>
  );
}

/* ---------------- Views ---------------- */

function ViewHead({ title, sub, actions }: { title: string; sub: string; actions?: ReactNode }) {
  return (
    <div className="view-head">
      <div className="title-row">
        <h1>{title}</h1>
        {actions && <div className="head-actions">{actions}</div>}
      </div>
      <p className="sub">{sub}</p>
    </div>
  );
}

function RunsView(p: any) {
  const {
    mode, setMode, topic, setTopic, sections, setSections, demoMode, setDemoMode,
    hostMode, setHostMode, autoApprove, setAutoApprove, avatars, avatarId, setAvatarId,
    voices, voiceId, setVoiceId, runwayTakes, setRunwayTakes, music, setMusic,
    busy, runState, runLog, runTail, tailRef, startRun, onViewResult,
  } = p;

  // Which controls are relevant to the currently-selected engine.
  const usesVoice = mode === 'demo' ? (demoMode === 'voiceover' || demoMode === 'broll') : hostMode === 'voice_only';
  const usesRunway = mode === 'demo' ? demoMode === 'broll' : hostMode === 'voice_only';
  // Background music is a demo-render option (the full pipeline scores music via its own agent).
  const showAV = mode === 'demo' || usesVoice || usesRunway;

  const audioVideoControls = showAV && (
    <>
      <div className="ctrl-divider"><span>Audio &amp; video</span></div>
      {mode === 'demo' && (
        <label className="switch-row">
          <input type="checkbox" checked={music} onChange={(e) => setMusic(e.target.checked)} />
          <span>Background music <span className="hint">(ElevenLabs — needs API key; looped bed, ducked under narration)</span></span>
        </label>
      )}
      {usesVoice && (
        <>
          <label>Narration voice (ElevenLabs)</label>
          <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
            {voices.map((v: VoiceOption) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </>
      )}
      {usesRunway && (
        <>
          <label>Runway takes per shot <span className="hint">(higher = better pick, more spend)</span></label>
          <select value={runwayTakes} onChange={(e) => setRunwayTakes(Number(e.target.value))}>
            {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} take{n > 1 ? 's' : ''}</option>)}
          </select>
        </>
      )}
    </>
  );

  return (
    <>
      <ViewHead title="New run" sub="Trigger a quick demo render or the full research → publish pipeline." />

      <div className="grid cols">
        <div className="card">
          <h2>Configuration</h2>
          <div className="seg">
            <button className={mode === 'demo' ? '' : 'off'} onClick={() => setMode('demo')} type="button">Demo video</button>
            <button className={mode === 'pipeline' ? '' : 'off'} onClick={() => setMode('pipeline')} type="button">Full pipeline</button>
          </div>

          {mode === 'demo' ? (
            <>
              <label>Topic</label>
              <input type="text" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="What should the episode be about?" />
              <div className="row">
                <div>
                  <label>Sections</label>
                  <select value={sections} onChange={(e) => setSections(Number(e.target.value))}>
                    {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div>
                  <label>Engine</label>
                  <select value={demoMode} onChange={(e) => setDemoMode(e.target.value)}>
                    <option value="auto">Auto (HeyGen if keyed)</option>
                    <option value="avatar">HeyGen avatar (talking head)</option>
                    <option value="broll">Runway b-roll (cinematic)</option>
                    <option value="voiceover">Voiceover slates (ElevenLabs)</option>
                  </select>
                </div>
              </div>
              {(demoMode === 'auto' || demoMode === 'avatar') && (
                <>
                  <label>Avatar</label>
                  <select value={avatarId} onChange={(e) => setAvatarId(e.target.value)}>
                    {avatars.map((a: AvatarOption) => <option key={a.id} value={a.id}>{a.label}</option>)}
                  </select>
                </>
              )}
              <p className="note">
                {demoMode === 'broll'
                  ? 'Runway generates cinematic footage per section (text→image→video) with ElevenLabs narration — a few minutes per clip.'
                  : 'Avatar mode calls HeyGen per section and can take a few minutes — watch progress on the right.'}
              </p>
            </>
          ) : (
            <>
              <div className="row">
                <div>
                  <label>Engine</label>
                  <select value={hostMode} onChange={(e) => setHostMode(e.target.value)}>
                    <option value="avatar">HeyGen avatar (talking head)</option>
                    <option value="voice_only">Runway b-roll (cinematic)</option>
                  </select>
                </div>
                <div>
                  <label>Gates</label>
                  <select value={autoApprove ? 'auto' : 'manual'} onChange={(e) => setAutoApprove(e.target.value === 'auto')}>
                    <option value="auto">Auto-approve (run to the end)</option>
                    <option value="manual">Hold at review gates</option>
                  </select>
                </div>
              </div>
              {hostMode === 'avatar' && (
                <>
                  <label>Avatar</label>
                  <select value={avatarId} onChange={(e) => setAvatarId(e.target.value)}>
                    {avatars.map((a: AvatarOption) => <option key={a.id} value={a.id}>{a.label}</option>)}
                  </select>
                </>
              )}
              <p className="note">Runs the full research → script → media → render → QA → publish pipeline.</p>
            </>
          )}

          {audioVideoControls}

          <button onClick={startRun} disabled={busy || runState === 'running'} type="button">
            {busy || runState === 'running' ? <><span className="spin" />Running…</> : mode === 'demo' ? 'Render demo' : 'Start pipeline'}
          </button>
        </div>

        <div className="card">
          <h2>Live progress</h2>
          {!runLog ? (
            <p className="empty">No active run. Configure a run and hit <strong>{mode === 'demo' ? 'Render demo' : 'Start pipeline'}</strong> to watch progress here.</p>
          ) : (
            <div className="toast">
              <div className="toast-head">
                <span>
                  {runState === 'running' && <><span className="spin" />Working…</>}
                  {runState === 'done' && <span className="ok">✅ Done</span>}
                  {runState === 'failed' && <span className="bad">⚠ Run failed</span>}
                </span>
                {runState === 'done' && <button type="button" className="ghost" onClick={onViewResult}>View result ▸</button>}
              </div>
              <pre ref={tailRef} className="logbox">{runTail || 'starting…'}</pre>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function LibraryView({ episodes, configured, onPreview, onNewRun }: {
  episodes: Episode[]; configured: boolean; onPreview: (id: string, bust?: number) => void; onNewRun: () => void;
}) {
  return (
    <>
      <ViewHead
        title="Library"
        sub="Every episode and its current state, refreshed live."
        actions={<button type="button" className="ghost" onClick={onNewRun}>+ New run</button>}
      />

      {!configured && (
        <div className="banner">
          <span>⚠</span>
          <span>
            Supabase isn’t configured, so the episode list is empty. Add <code>SUPABASE_URL</code> and a
            key to the repo-root <code>.env</code>. Demo renders still work and appear under Preview.
          </span>
        </div>
      )}

      <div className="card">
        <h2>Episodes</h2>
        {episodes.length === 0 ? (
          <p className="empty">No episodes yet. Start a run to see them here.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Episode</th><th>Status</th><th>Niche</th><th>Spent</th><th>Updated</th> </th></tr>
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
                      ? <a className="play" onClick={() => onPreview(e.episode_id, 0)}>▶ preview</a>
                      : <span style={{ color: 'var(--faint)' }}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function PreviewView({ preview, videoSrc, onLatestDemo, onClear, setVideoBust, onBrowse }: {
  preview: string | null; videoSrc: (id: string) => string;
  onLatestDemo: () => void; onClear: () => void; setVideoBust: (n: number) => void; onBrowse: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(false);
  const [loop, setLoop] = useState(false);
  const [rate, setRate] = useState(1);

  // playbackRate isn't a JSX attribute, so apply it imperatively whenever it changes
  // or a new clip loads.
  useEffect(() => { if (videoRef.current) videoRef.current.playbackRate = rate; }, [rate, preview]);

  const src = preview ? videoSrc(preview) : '';
  const download = preview ? `sparx-${preview === 'demo' ? 'demo' : preview}.mp4` : undefined;

  async function togglePip() {
    const el = videoRef.current;
    if (!el) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await el.requestPictureInPicture();
    } catch { /* PiP unsupported or blocked — ignore */ }
  }

  return (
    <>
      <ViewHead
        title="Preview"
        sub="Play the latest demo render or any episode’s rendered cut."
        actions={
          <>
            <button type="button" className="ghost" onClick={() => { onLatestDemo(); setVideoBust(Date.now()); }}>Latest demo</button>
            {preview && <button type="button" className="ghost" onClick={onClear}>Clear</button>}
          </>
        }
      />

      <div className="card">
        {preview ? (
          <>
            <div className="player-meta">
              <span>Now playing:</span>
              <span className="mono">{preview === 'demo' ? 'latest demo render' : preview}</span>
            </div>
            <video ref={videoRef} key={`${preview}-${src}`} controls autoPlay muted={muted} loop={loop} src={src} />

            <div className="player-controls">
              <button type="button" className={`pill ${muted ? 'on' : ''}`} onClick={() => setMuted((m) => !m)}>
                {muted ? '🔇 Muted' : '🔊 Sound'}
              </button>
              <button type="button" className={`pill ${loop ? 'on' : ''}`} onClick={() => setLoop((l) => !l)}>
                🔁 Loop
              </button>
              <label className="pill-select">
                Speed
                <select value={rate} onChange={(e) => setRate(Number(e.target.value))}>
                  {[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => <option key={r} value={r}>{r}×</option>)}
                </select>
              </label>
              <button type="button" className="pill" onClick={togglePip}>🗔 PiP</button>
              <a className="pill" href={src} download={download}>⬇ Download</a>
            </div>
          </>
        ) : (
          <p className="empty">
            Nothing loaded. Load the <strong>Latest demo</strong> above, or <a className="play" onClick={onBrowse}>browse the Library</a> and hit “preview” on an episode.
          </p>
        )}
      </div>
    </>
  );
}

function SetupView({ providers }: { providers: Provider[] }) {
  return (
    <>
      <ViewHead title="Setup" sub="Which provider API keys are wired up for this environment." />

      <div className="card">
        <h2>Providers</h2>
        <div className="providers">
          {providers.map((p) => (
            <span className="chip" key={p.env} title={p.env}>
              <span className={`dot ${p.configured ? 'on' : 'off'}`} />
              {p.key}
            </span>
          ))}
          {providers.length === 0 && <span style={{ color: 'var(--muted)' }}>loading…</span>}
        </div>
        <p className="note">Green = key present in <code>.env</code>. Blank keys fall back to mocks.</p>
      </div>
    </>
  );
}
