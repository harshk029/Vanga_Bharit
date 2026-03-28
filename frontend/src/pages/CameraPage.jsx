import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { wsService } from '../services/websocket';
import './CameraPage.css';

export default function CameraPage({ feedUrl, title, subtitle, color, hideAlerts = false, showReset = false, enableSiren = false, trespassOnly = false }) {
  const navigate = useNavigate();
  const [wsStatus, setWsStatus]   = useState('disconnected');
  const [alerts, setAlerts]       = useState([]);
  const [fullscreen, setFullscreen] = useState(false);
  const [resetting, setResetting]  = useState(false);
  const [imgKey, setImgKey]        = useState(0);
  const logRef = useRef(null);

  const playWeaponAlarm = () => {
    if (!enableSiren) return; // Strict safety gate: Never buzz on non-weapon pages
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(0.7, ctx.currentTime);
      masterGain.connect(ctx.destination);

      const playTone = (freq, type, startT, duration, fadeOut = true) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.connect(g);
        g.connect(masterGain);
        osc.type = type;
        osc.frequency.setValueAtTime(freq, startT);
        g.gain.setValueAtTime(0.8, startT);
        if (fadeOut) {
          g.gain.exponentialRampToValueAtTime(0.001, startT + duration);
        }
        osc.start(startT);
        osc.stop(startT + duration);
        return osc;
      };

      // Stage 1: Rising whoop — 300→1400 Hz sweep (0ms–400ms)
      const sweep = ctx.createOscillator();
      const sweepGain = ctx.createGain();
      sweep.connect(sweepGain);
      sweepGain.connect(masterGain);
      sweep.type = 'sawtooth';
      sweep.frequency.setValueAtTime(300, ctx.currentTime);
      sweep.frequency.exponentialRampToValueAtTime(1400, ctx.currentTime + 0.4);
      sweepGain.gain.setValueAtTime(0.9, ctx.currentTime);
      sweepGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      sweep.start(ctx.currentTime);
      sweep.stop(ctx.currentTime + 0.4);

      // Stage 2: Triple staccato blasts (450ms, 600ms, 750ms)
      [0.45, 0.60, 0.75].forEach((t) => {
        playTone(1100, 'square', ctx.currentTime + t, 0.12);
      });

      // Stage 3: Heavy low rumble (900ms–1.4s) — feels dangerous
      playTone(90, 'sawtooth', ctx.currentTime + 0.9, 0.5, true);

      // Stage 4: High shriek on loop (950ms–1.5s)
      const shriek = ctx.createOscillator();
      const shriekGain = ctx.createGain();
      shriek.connect(shriekGain);
      shriekGain.connect(masterGain);
      shriek.type = 'square';
      shriek.frequency.setValueAtTime(1800, ctx.currentTime + 0.95);
      shriek.frequency.setValueAtTime(900, ctx.currentTime + 1.15);
      shriek.frequency.setValueAtTime(1800, ctx.currentTime + 1.30);
      shriekGain.gain.setValueAtTime(0.6, ctx.currentTime + 0.95);
      shriekGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.5);
      shriek.start(ctx.currentTime + 0.95);
      shriek.stop(ctx.currentTime + 1.5);

    } catch (e) {
      console.warn('Audio play failed:', e);
    }
  };

  useEffect(() => {
    const unsubS = wsService.onStatusChange(setWsStatus);
    const unsubM = wsService.onMessage((d) => {
      if (d?.level === 'alert') {
        // Only play weapon alarm on pages that explicitly request it (cam3 only)
        if (enableSiren && d.msg?.includes('WEAPON DETECTED')) {
          playWeaponAlarm();
        }
        // If trespassOnly, ignore anything that isn't a trespass alert
        if (trespassOnly && !d.msg?.includes('TRESPASS')) return;
        setAlerts((p) => [...p, { ...d, id: Date.now() }].slice(-100));
      }
    });
    wsService.connect();
    return () => { unsubS(); unsubM(); wsService.disconnect(); };
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [alerts]);

  const handleReset = async () => {
    setResetting(true);
    try {
      await fetch('/reset_cam1', { method: 'POST' });
      setAlerts([]);
      setImgKey(k => k + 1); // force img reload
    } catch(e) { /* ignore */ }
    setTimeout(() => setResetting(false), 1500);
  };

  const wsLabel = { connected:'Online', connecting:'Connecting...', disconnected:'Offline' }[wsStatus];
  const wsColor = { connected:'#10b981', connecting:'#f59e0b', disconnected:'#ef4444' }[wsStatus];

  return (
    <div className="cp-page">
      {/* Top bar */}
      <header className="cp-topbar" style={{ '--accent': color }}>
        <button className="cp-back" onClick={() => navigate('/dashboard')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="2.5">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          Back
        </button>

        <div className="cp-title-wrap">
          <div className="cp-dot" style={{ background: color, boxShadow: `0 0 8px ${color}99` }} />
          <span className="cp-title">{title}</span>
          <span className="cp-subtitle">{subtitle}</span>
        </div>

        <div className="cp-ws-pill">
          <span style={{ width:7, height:7, borderRadius:'50%', background:wsColor,
                         boxShadow:`0 0 6px ${wsColor}`, display:'inline-block' }} />
          {wsLabel}
        </div>
      </header>

      {/* Two-panel grid */}
      <main className={`cp-grid ${fullscreen || hideAlerts ? 'cp-grid--fs' : ''}`}>
        {/* Video Panel */}
        <div className="cp-panel cp-panel--video">
          <div className="cp-panel-hdr">
            <span className="cp-rec-dot" />
            <span>LIVE FEED</span>
            <span style={{ marginLeft:'auto', fontSize:'.68rem', color:'rgba(148,163,184,.4)', fontFamily:'monospace' }}>
              {subtitle}
            </span>
            {!hideAlerts && (
              <button className="cp-fs-btn" onClick={() => setFullscreen(f => !f)}>
                {fullscreen ? '⤡' : '⤢'}
              </button>
            )}
          </div>
          <div className="cp-feed" onClick={() => !hideAlerts && setFullscreen(f => !f)}
               style={{ cursor: hideAlerts ? 'default' : (fullscreen ? 'zoom-out' : 'zoom-in') }}>
            <img key={imgKey} src={feedUrl} alt="Live feed" className="cp-feed-img" draggable={false} />
            {!hideAlerts && <div className="cp-feed-hint">{fullscreen ? 'Click to exit' : 'Click to expand'}</div>}
          </div>
          {showReset && (
            <div style={{ textAlign: 'right', padding: '4px 8px' }}>
              <button
                onClick={handleReset}
                disabled={resetting}
                style={{
                  fontSize: '0.62rem', padding: '3px 10px',
                  background: resetting ? '#374151' : '#1e293b',
                  color: resetting ? '#6b7280' : '#94a3b8',
                  border: '1px solid #334155', borderRadius: '4px',
                  cursor: resetting ? 'not-allowed' : 'pointer',
                  letterSpacing: '0.05em'
                }}
              >
                {resetting ? '↺ Resetting…' : '↺ Reset Feed'}
              </button>
            </div>
          )}
        </div>

        {/* Alert Panel */}
        {!hideAlerts && (
          <div className={`cp-panel cp-panel--alerts ${fullscreen ? 'cp-panel--hidden' : ''}`}>
          <div className="cp-panel-hdr">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                 stroke="#f87171" strokeWidth="2.5">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            SECURITY ALERTS
            <span className="cp-badge">{alerts.length}</span>
          </div>
          <div className="cp-log" ref={logRef}>
            {alerts.length === 0
              ? <div className="cp-empty">No alerts yet. Monitoring...</div>
              : alerts.slice().reverse().map(a => (
                  <div key={a.id} className="cp-alert-row">
                    <span>{a.msg?.includes('TRESPASS') ? '🚨' : '⚠️'}</span>
                    <div>
                      <p className="cp-alert-msg">{a.msg}</p>
                      <p className="cp-alert-ts">{new Date(a.ts * 1000).toLocaleTimeString()}</p>
                    </div>
                  </div>
                ))
            }
          </div>
          <div className="cp-stats">
            <div className="cp-stat">
              <strong>{alerts.filter(a=>a.msg?.includes('TRESPASS')).length}</strong>
              <span>Trespass</span>
            </div>
            <div className="cp-stat-div" />
            <div className="cp-stat">
              <strong>{alerts.filter(a=>a.msg?.includes('LOITER')).length}</strong>
              <span>Loitering</span>
            </div>
            <div className="cp-stat-div" />
            <div className="cp-stat">
              <strong>{alerts.length}</strong>
              <span>Total</span>
            </div>
          </div>
        </div>
        )}
      </main>
    </div>
  );
}
