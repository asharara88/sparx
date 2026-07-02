'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, ReactElement, ReactNode, SetStateAction } from 'react';

interface Provider { key: string; env: string; configured: boolean }
interface AvatarOption { id: string; label: string }
interface VoiceOption { id: string; label: string }
interface Episode {
  episode_id: string; status: string; niche: string | null; host_mode: string;
  spent_usd: number; updated_at: string; hasVideo: boolean;
}

type View = 'runs' | 'library' | 'preview' | 'setup';
type RunMode = 'demo' | 'pipeline';
type DemoMode = 'auto' | 'avatar' | 'voiceover' | 'broll';
type HostMode = 'avatar' | 'voice_only';
type AvatarVoice = 'auto' | 'elevenlabs' | 'heygen';
type RunState = 'idle' | 'running' | 'done' | 'failed';

// Stroke-icon paths (lucide-style, 24x24) — one visual language everywhere instead
// of emoji, which vary in weight/color per OS and are missing glyphs on some.
const IC = {
  play: 'M5 3l14 9-14 9V3z',
  check: 'M20 6L9 17l-4-4',
  alert: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01',
  volume: 'M11 5L6 9H2v6h4l5 4V5zM15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14',
  volumeX: 'M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6',
  repeat: 'M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3',
  pip: 'M21 9V6a2 2 0 0 0-2-2H3a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4M12 13h10v7H12z',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  retry: 'M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15',
};

const NAV: { id: View; label: string; icon: ReactElement }[] = [
  { id: 'runs', label: 'Runs', icon: <Icon d={IC.play} /> },
  { id: 'library', label: 'Library', icon: <Icon d="M4 6h16M4 12h16M4 18h16" /> },
  { id: 'preview', label: 'Preview', icon: <Icon d="M2 6a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6zm15 4l5-3v10l-5-3" /> },
  { id: 'setup', label: 'Setup', icon: <Icon d="M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 008 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H2a2 2 0 110-4h.09A1.65 1.65 0 004.6 8a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 008.92 3.7 1.65 1.65 0 0010 2.19V2a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0020.3 8" /> },
];

function Icon({ d, className = 'nav-icon' }: { d: string; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return m ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

// Compact recency for the Library table; the full timestamp lives in the title attr.
function relTime(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (s < 3600) return rtf.format(-Math.floor(s / 60), 'minute');
  if (s < 86400) return rtf.format(-Math.floor(s / 3600), 'hour');
  if (s < 7 * 86400) return rtf.format(-Math.floor(s / 86400), 'day');
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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
  const [runState, setRunState] = useState<RunState>('idle');
  // The mode the ACTIVE run was started with — the form's `mode` can be flipped
  // mid-run, so completion handling must not read the live form state.
  const [runMode, setRunMode] = useState<RunMode>('demo');
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const tailRef = useRef<HTMLPreElement>(null);
  const pinnedRef = useRef(true); // is the log scrolled to the bottom?

  // run form state
  const [mode, setMode] = useState<RunMode>('demo');
  const [topic, setTopic] = useState('Three AI tools every creator should try');
  const [sections, setSections] = useState(3);
  const [demoMode, setDemoMode] = useState<DemoMode>('auto');
  const [hostMode, setHostMode] = useState<HostMode>('avatar');
  const [autoApprove, setAutoApprove] = useState(true);
  const [avatars, setAvatars] = useState<AvatarOption[]>([]);
  const [avatarId, setAvatarId] = useState('');
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [voiceId, setVoiceId] = useState('');
  const [avatarVoice, setAvatarVoice] = useState<AvatarVoice>('auto');
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
          if (j.ok && runMode === 'demo' && j.videoMtime) {
            setVideoBust(j.videoMtime);
            // Load/refresh the demo preview — but never hijack an episode the
            // user is currently watching (that would remount their video).
            setPreview((p) => (p === null || p === 'demo' ? 'demo' : p));
          }
          loadEpisodes();
        }
      } catch { /* keep polling */ }
    };
    tick();
    const t = setInterval(tick, 2000);
    return () => { stop = true; clearInterval(t); };
  }, [runLog, runState, runMode, loadEpisodes]);

  // Elapsed-time ticker for the live progress card (freezes on done/failed).
  useEffect(() => {
    if (runState !== 'running') return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [runState]);
  const elapsed = runStartedAt ? fmtElapsed(now - runStartedAt) : '';

  // Keep the log pinned to the bottom only while the user hasn't scrolled away.
  useEffect(() => {
    const el = tailRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [runTail]);
  const onLogScroll = useCallback(() => {
    const el = tailRef.current;
    if (el) pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, []);

  async function startRun() {
    setBusy(true);
    setRunTail('');
    setRunState('idle');
    setRunLog(null);
    try {
      // Which engines actually consume each control:
      //  · ElevenLabs voice → voiceover + b-roll (demo), voice_only (pipeline), and
      //    avatar lip-sync when the avatar voice is set to ElevenLabs
      //  · Runway takes      → b-roll (demo) and voice_only (pipeline)
      const usesAvatar = mode === 'demo' ? (demoMode === 'auto' || demoMode === 'avatar') : hostMode === 'avatar';
      const usesVoice = (mode === 'demo' ? (demoMode === 'voiceover' || demoMode === 'broll') : hostMode === 'voice_only')
        || (usesAvatar && avatarVoice === 'elevenlabs');
      const usesRunway = mode === 'demo' ? demoMode === 'broll' : hostMode === 'voice_only';
      const avatarOpts = usesAvatar && avatarVoice !== 'auto' ? { avatarVoice } : {};
      const body = mode === 'demo'
        ? { mode, topic, sections, demoMode: demoMode === 'auto' ? undefined : demoMode, avatarId, music, ...avatarOpts, ...(usesVoice ? { voiceId } : {}), ...(usesRunway ? { runwayTakes } : {}) }
        : { mode, autoApprove, avatarId, hostMode, ...avatarOpts, ...(usesVoice ? { voiceId } : {}), ...(usesRunway ? { runwayTakes } : {}) };
      const r = await fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (j.started && j.log) {
        setRunMode(mode);
        setRunStartedAt(Date.now());
        pinnedRef.current = true;
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
              aria-label={n.label}
              aria-current={view === n.id ? 'page' : undefined}
              onClick={() => setView(n.id)}
            >
              {n.icon}
              <span className="nav-label">{n.label}</span>
              {n.id === 'library' && episodes.length > 0 && <span className="nav-badge">{episodes.length}</span>}
              {n.id === 'runs' && runState === 'running' && <span className="nav-badge"><span className="spin" style={{ margin: 0 }} aria-hidden="true" /></span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <button
            type="button"
            className="health"
            aria-label={`Provider setup: ${providerHealth.total ? `${providerHealth.on} of ${providerHealth.total}` : 'unknown'} providers keyed`}
            onClick={() => setView('setup')}
          >
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
            {...{ mode, setMode, topic, setTopic, sections, setSections, demoMode, setDemoMode, hostMode, setHostMode, autoApprove, setAutoApprove, avatars, avatarId, setAvatarId, voices, voiceId, setVoiceId, avatarVoice, setAvatarVoice, runwayTakes, setRunwayTakes, music, setMusic, busy, runState, runMode, runLog, runTail, elapsed, tailRef, onLogScroll, startRun }}
            onViewResult={() => {
              if (runMode === 'pipeline') setView('library');
              else { setPreview('demo'); setView('preview'); }
            }}
          />
        )}

        {view === 'library' && (
          <LibraryView episodes={episodes} configured={configured} onPreview={openPreview} onNewRun={() => setView('runs')} />
        )}

        {view === 'preview' && (
          <PreviewView preview={preview} videoSrc={videoSrc} onLatestDemo={() => setPreview('demo')} onClear={() => setPreview(null)} setVideoBust={setVideoBust} onBrowse={() => setView('library')} onRuns={() => setView('runs')} />
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

interface RunsViewProps {
  mode: RunMode; setMode: Dispatch<SetStateAction<RunMode>>;
  topic: string; setTopic: Dispatch<SetStateAction<string>>;
  sections: number; setSections: Dispatch<SetStateAction<number>>;
  demoMode: DemoMode; setDemoMode: Dispatch<SetStateAction<DemoMode>>;
  hostMode: HostMode; setHostMode: Dispatch<SetStateAction<HostMode>>;
  autoApprove: boolean; setAutoApprove: Dispatch<SetStateAction<boolean>>;
  avatars: AvatarOption[]; avatarId: string; setAvatarId: Dispatch<SetStateAction<string>>;
  voices: VoiceOption[]; voiceId: string; setVoiceId: Dispatch<SetStateAction<string>>;
  avatarVoice: AvatarVoice; setAvatarVoice: Dispatch<SetStateAction<AvatarVoice>>;
  runwayTakes: number; setRunwayTakes: Dispatch<SetStateAction<number>>;
  music: boolean; setMusic: Dispatch<SetStateAction<boolean>>;
  busy: boolean; runState: RunState; runMode: RunMode; runLog: string | null; runTail: string; elapsed: string;
  tailRef: { current: HTMLPreElement | null }; onLogScroll: () => void;
  startRun: () => void; onViewResult: () => void;
}

function RunsView(p: RunsViewProps) {
  const {
    mode, setMode, topic, setTopic, sections, setSections, demoMode, setDemoMode,
    hostMode, setHostMode, autoApprove, setAutoApprove, avatars, avatarId, setAvatarId,
    voices, voiceId, setVoiceId, avatarVoice, setAvatarVoice, runwayTakes, setRunwayTakes, music, setMusic,
    busy, runState, runMode, runLog, runTail, elapsed, tailRef, onLogScroll, startRun, onViewResult,
  } = p;

  // Which controls are relevant to the currently-selected engine.
  const usesAvatar = mode === 'demo' ? (demoMode === 'auto' || demoMode === 'avatar') : hostMode === 'avatar';
  const usesVoice = (mode === 'demo' ? (demoMode === 'voiceover' || demoMode === 'broll') : hostMode === 'voice_only')
    || (usesAvatar && avatarVoice === 'elevenlabs');
  const usesRunway = mode === 'demo' ? demoMode === 'broll' : hostMode === 'voice_only';
  // Background music is a demo-render option (the full pipeline scores music via its own agent).
  const showAV = mode === 'demo' || usesVoice || usesRunway;

  // Demo-only progress sugar: surface the latest "section i/n" line from the log.
  const stageMatches = [...runTail.matchAll(/section (\d+)\/(\d+)/g)];
  const lastStage = stageMatches[stageMatches.length - 1];
  const stage = runState === 'running' && lastStage ? `Rendering section ${lastStage[1]}/${lastStage[2]}` : null;

  // Lip-sync source for avatar clips: your ElevenLabs voice (uploaded to HeyGen,
  // mouth synced to that audio) vs HeyGen's built-in TTS.
  const avatarVoiceControl = (
    <>
      <label htmlFor="run-avatar-voice">Avatar voice <span className="hint">(lip-sync source)</span></label>
      <select id="run-avatar-voice" value={avatarVoice} onChange={(e) => setAvatarVoice(e.target.value as AvatarVoice)}>
        <option value="auto">Auto (ElevenLabs if keyed)</option>
        <option value="elevenlabs">My ElevenLabs voice (lip-synced)</option>
        <option value="heygen">HeyGen voice (built-in TTS)</option>
      </select>
    </>
  );

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
          <label htmlFor="run-voice">Narration voice (ElevenLabs)</label>
          <select id="run-voice" value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
            {voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </>
      )}
      {usesRunway && (
        <>
          <label htmlFor="run-takes">Runway takes per shot <span className="hint">(higher = better pick, more spend)</span></label>
          <select id="run-takes" value={runwayTakes} onChange={(e) => setRunwayTakes(Number(e.target.value))}>
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
          <div className="seg" role="group" aria-label="Run mode">
            <button className={mode === 'demo' ? '' : 'off'} aria-pressed={mode === 'demo'} onClick={() => setMode('demo')} type="button">Demo video</button>
            <button className={mode === 'pipeline' ? '' : 'off'} aria-pressed={mode === 'pipeline'} onClick={() => setMode('pipeline')} type="button">Full pipeline</button>
          </div>

          {mode === 'demo' ? (
            <>
              <label htmlFor="run-topic">Topic</label>
              <input id="run-topic" type="text" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="What should the episode be about?" />
              <div className="row">
                <div>
                  <label htmlFor="run-sections">Sections</label>
                  <select id="run-sections" value={sections} onChange={(e) => setSections(Number(e.target.value))}>
                    {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="run-engine-demo">Engine</label>
                  <select id="run-engine-demo" value={demoMode} onChange={(e) => setDemoMode(e.target.value as DemoMode)}>
                    <option value="auto">Auto (HeyGen if keyed)</option>
                    <option value="avatar">HeyGen avatar (talking head)</option>
                    <option value="broll">Runway b-roll (cinematic)</option>
                    <option value="voiceover">Voiceover slates (ElevenLabs)</option>
                  </select>
                </div>
              </div>
              {(demoMode === 'auto' || demoMode === 'avatar') && (
                <>
                  <label htmlFor="run-avatar-demo">Avatar</label>
                  <select id="run-avatar-demo" value={avatarId} onChange={(e) => setAvatarId(e.target.value)}>
                    {avatars.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                  </select>
                  {avatarVoiceControl}
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
                  <label htmlFor="run-engine-pipeline">Engine</label>
                  <select id="run-engine-pipeline" value={hostMode} onChange={(e) => setHostMode(e.target.value as HostMode)}>
                    <option value="avatar">HeyGen avatar (talking head)</option>
                    <option value="voice_only">Runway b-roll (cinematic)</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="run-gates">Gates</label>
                  <select id="run-gates" value={autoApprove ? 'auto' : 'manual'} onChange={(e) => setAutoApprove(e.target.value === 'auto')}>
                    <option value="auto">Auto-approve (run to the end)</option>
                    <option value="manual">Hold at review gates</option>
                  </select>
                </div>
              </div>
              {hostMode === 'avatar' && (
                <>
                  <label htmlFor="run-avatar-pipeline">Avatar</label>
                  <select id="run-avatar-pipeline" value={avatarId} onChange={(e) => setAvatarId(e.target.value)}>
                    {avatars.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                  </select>
                  {avatarVoiceControl}
                </>
              )}
              <p className="note">Runs the full research → script → media → render → QA → publish pipeline.</p>
            </>
          )}

          {audioVideoControls}

          <button onClick={startRun} disabled={busy || runState === 'running'} type="button">
            {busy || runState === 'running' ? <><span className="spin" aria-hidden="true" />Running…</> : mode === 'demo' ? 'Render demo' : 'Start pipeline'}
          </button>
        </div>

        <div className="card">
          <h2>Live progress</h2>
          {!runLog && runState !== 'failed' ? (
            <p className="empty">No active run. Configure a run and hit <strong>{mode === 'demo' ? 'Render demo' : 'Start pipeline'}</strong> to watch progress here.</p>
          ) : (
            <div className="toast">
              <div className="toast-head">
                <span className="run-state" role="status">
                  {runState === 'running' && <><span className="spin" aria-hidden="true" />Working…{elapsed ? ` ${elapsed}` : ''}</>}
                  {runState === 'done' && <span className="ok"><Icon d={IC.check} className="icon-sm" /> Done{elapsed ? ` in ${elapsed}` : ''}</span>}
                  {runState === 'failed' && <span className="bad"><Icon d={IC.alert} className="icon-sm" /> Run failed</span>}
                  {runState === 'idle' && 'Starting…'}
                </span>
                {runState === 'done' && <button type="button" className="ghost" onClick={onViewResult}>{runMode === 'pipeline' ? 'Open Library ▸' : 'View result ▸'}</button>}
                {runState === 'failed' && <button type="button" className="ghost" onClick={startRun} disabled={busy}><Icon d={IC.retry} className="icon-sm" /> Retry</button>}
              </div>
              {stage && <div className="toast-stage">{stage}</div>}
              <pre ref={tailRef} onScroll={onLogScroll} className="logbox" tabIndex={0} role="region" aria-label="Run log">{runTail || 'starting…'}</pre>
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
          <Icon d={IC.alert} className="icon-sm" />
          <span>
            Supabase isn’t configured, so the episode list is empty. Add <code>SUPABASE_URL</code> and a
            key to the repo-root <code>.env</code>. Demo renders still work and appear under Preview.
          </span>
        </div>
      )}

      <div className="card">
        <h2>Episodes</h2>
        {episodes.length === 0 ? (
          <p className="empty">
            No episodes yet.<br />
            <button type="button" className="ghost" style={{ marginTop: 12 }} onClick={onNewRun}>Start your first run</button>
          </p>
        ) : (
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Episodes table">
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
                    <td className="mono" title={new Date(e.updated_at).toLocaleString()}>{relTime(e.updated_at)}</td>
                    <td>{e.hasVideo
                      ? <button type="button" className="play" onClick={() => onPreview(e.episode_id, 0)}><Icon d={IC.play} className="icon-sm" /> preview</button>
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

function PreviewView({ preview, videoSrc, onLatestDemo, onClear, setVideoBust, onBrowse, onRuns }: {
  preview: string | null; videoSrc: (id: string) => string;
  onLatestDemo: () => void; onClear: () => void; setVideoBust: (n: number) => void; onBrowse: () => void; onRuns: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Muted by default so autoplay is reliable cross-browser (Safari/Chrome block
  // unmuted autoplay); one click — ours or the native control — unmutes.
  const [muted, setMuted] = useState(true);
  const [loop, setLoop] = useState(false);
  const [rate, setRate] = useState(1);
  const [loadError, setLoadError] = useState(false);

  const src = preview ? videoSrc(preview) : '';
  const download = preview ? `sparx-${preview === 'demo' ? 'demo' : preview}.mp4` : undefined;

  // playbackRate isn't a JSX attribute, so apply it imperatively. Depend on `src`
  // (not `preview`): the element remounts whenever src changes — including pure
  // cache-busts of the same preview — and a fresh element resets to 1x.
  useEffect(() => { if (videoRef.current) videoRef.current.playbackRate = rate; }, [rate, src]);
  useEffect(() => { setLoadError(false); }, [src]);

  function toggleMute() {
    const el = videoRef.current;
    if (el) el.muted = !muted;
    setMuted((m) => !m);
  }

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
        {preview && loadError ? (
          <p className="empty">
            {/* MEDIA_ERR_SRC_NOT_SUPPORTED covers both "no file yet" (404) and
                "browser can't decode it" — keep the copy honest about both. */}
            {preview === 'demo' ? (
              <>Couldn’t play the demo render — if none exists yet, start one from Runs.<br />
                <button type="button" className="ghost" style={{ marginTop: 12 }} onClick={onRuns}>Go to Runs</button></>
            ) : (
              <>This episode’s video couldn’t be loaded or played.<br />
                <button type="button" className="ghost" style={{ marginTop: 12 }} onClick={onBrowse}>Back to Library</button></>
            )}
          </p>
        ) : preview ? (
          <>
            <div className="player-meta">
              <span>Now playing:</span>
              <span className="mono">{preview === 'demo' ? 'latest demo render' : preview}</span>
            </div>
            <video
              ref={videoRef}
              key={`${preview}-${src}`}
              controls
              autoPlay
              muted={muted}
              loop={loop}
              src={src}
              onError={() => setLoadError(true)}
              onVolumeChange={() => { const el = videoRef.current; if (el) setMuted(el.muted); }}
            />

            <div className="player-controls">
              <button type="button" className={`pill ${muted ? 'on' : ''}`} aria-pressed={muted} onClick={toggleMute}>
                <Icon d={muted ? IC.volumeX : IC.volume} className="icon-sm" />{muted ? 'Unmute' : 'Mute'}
              </button>
              <button type="button" className={`pill ${loop ? 'on' : ''}`} aria-pressed={loop} onClick={() => setLoop((l) => !l)}>
                <Icon d={IC.repeat} className="icon-sm" />Loop
              </button>
              <label className="pill-select">
                Speed
                <select value={rate} onChange={(e) => setRate(Number(e.target.value))}>
                  {[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => <option key={r} value={r}>{r}×</option>)}
                </select>
              </label>
              <button type="button" className="pill" onClick={togglePip}><Icon d={IC.pip} className="icon-sm" />PiP</button>
              <a className="pill" href={src} download={download}><Icon d={IC.download} className="icon-sm" />Download</a>
            </div>
          </>
        ) : (
          <p className="empty">
            Nothing loaded. Load the <strong>Latest demo</strong> above, or <button type="button" className="play" onClick={onBrowse}>browse the Library</button> and hit “preview” on an episode.
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
