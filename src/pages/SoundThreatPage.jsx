import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import './SoundThreatPage.css';

const THREAT_META = {
  'Gunshot':             { color: '#ef4444', icon: '🔫', alert: true },
  'Screaming / Yelling': { color: '#f97316', icon: '😱', alert: true },
  'Glass Break':         { color: '#eab308', icon: '🪟', alert: true },
  'Loud Noise':          { color: '#a78bfa', icon: '📢', alert: false },
  'Normal':              { color: '#10b981', icon: '🔈', alert: false },
};

function fmt(ts) {
  return new Date(ts * 1000).toLocaleTimeString();
}

export default function SoundThreatPage() {
  const navigate = useNavigate();
  const canvasRef   = useRef(null);
  const audioRef    = useRef(null);      // <audio> element
  const ctxRef      = useRef(null);      // AudioContext
  const analyserRef = useRef(null);      // AnalyserNode
  const animRef     = useRef(null);      // rAF handle
  const sourceRef   = useRef(null);      // MediaElementSource (created once)

  const [current, setCurrent]   = useState(null);
  const [alertLog, setAlertLog] = useState([]);
  const [streamOk, setStreamOk] = useState(true);
  const [playing, setPlaying]   = useState(false);

  // ── SSE: backend classification events ────────────────────────────────────
  useEffect(() => {
    const es = new EventSource('/sound_analysis');
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data);
        setCurrent(ev);
        if (ev.threat) {
          setAlertLog(prev => [{ ...ev, id: Date.now() }, ...prev].slice(0, 60));
        }
        setStreamOk(true);
      } catch (_) {}
    };
    es.onerror = () => setStreamOk(false);
    return () => es.close();
  }, []);

  // ── Set up Web Audio API analyser ─────────────────────────────────────────
  const setupAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || ctxRef.current) return;          // already set up

    try {
      const ctx      = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.8;

      // MediaElementSource can only be created once per element
      if (!sourceRef.current) {
        sourceRef.current = ctx.createMediaElementSource(audio);
      }
      sourceRef.current.connect(analyser);
      analyser.connect(ctx.destination);

      ctxRef.current      = ctx;
      analyserRef.current = analyser;
    } catch (err) {
      console.warn('[Audio] setup failed:', err);
    }
  }, []);

  // ── Canvas waveform animation ──────────────────────────────────────────────
  const drawWave = useCallback(() => {
    const canvas   = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas) { animRef.current = requestAnimationFrame(drawWave); return; }

    const ctx = canvas.getContext('2d');
    const W   = canvas.width;
    const H   = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const meta  = current ? (THREAT_META[current.label] || THREAT_META['Normal']) : THREAT_META['Normal'];
    const color = meta.color;

    if (!analyser) {
      // Draw idle flat line
      ctx.beginPath();
      ctx.moveTo(0, H / 2);
      ctx.lineTo(W, H / 2);
      ctx.strokeStyle = 'rgba(100,200,255,0.15)';
      ctx.lineWidth = 1;
      ctx.stroke();
      animRef.current = requestAnimationFrame(drawWave);
      return;
    }

    const bufLen  = analyser.frequencyBinCount;
    const timeBuf = new Uint8Array(bufLen);
    analyser.getByteTimeDomainData(timeBuf);

    // meta and color are already defined at the top of drawWave
    ctx.shadowColor = color;
    ctx.shadowBlur  = current?.threat ? 18 : 7;

    // Draw waveform
    ctx.beginPath();
    const step = W / bufLen;
    for (let i = 0; i < bufLen; i++) {
      const v = timeBuf[i] / 128.0;
      const y = (v * H) / 2;
      if (i === 0) ctx.moveTo(0, y);
      else         ctx.lineTo(i * step, y);
    }
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0,   color + '44');
    grad.addColorStop(0.5, color);
    grad.addColorStop(1,   color + '44');
    ctx.strokeStyle = grad;
    ctx.lineWidth   = current?.threat ? 3 : 2;
    ctx.stroke();
    ctx.shadowBlur  = 0;

    // Filled area below
    ctx.lineTo(W, H / 2);
    ctx.lineTo(0, H / 2);
    ctx.closePath();
    ctx.fillStyle = color + '10';
    ctx.fill();

    animRef.current = requestAnimationFrame(drawWave);
  }, [current]);

  useEffect(() => {
    animRef.current = requestAnimationFrame(drawWave);
    return () => cancelAnimationFrame(animRef.current);
  }, [drawWave]);

  // ── Controls ───────────────────────────────────────────────────────────────
  const handlePlayPause = () => {
    const audio = audioRef.current;
    if (!audio) return;
    setupAudio();
    if (ctxRef.current?.state === 'suspended') ctxRef.current.resume();
    if (audio.paused) { audio.play(); setPlaying(true); }
    else              { audio.pause(); setPlaying(false); }
  };

  // Compute RMS-like level from analyser for the level bar
  const [level, setLevel] = useState(0);
  useEffect(() => {
    let raf;
    const tick = () => {
      const analyser = analyserRef.current;
      if (analyser) {
        const buf = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteTimeDomainData(buf);
        const rms = Math.sqrt(buf.reduce((s, v) => s + ((v - 128) ** 2), 0) / buf.length);
        setLevel(Math.min(100, (rms / 40) * 100));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const meta = current ? (THREAT_META[current.label] || THREAT_META['Normal']) : null;

  return (
    <div className="stp-page">
      {/* Hidden audio element — loops the Sound.mpeg file */}
      <audio
        ref={audioRef}
        src="/sound_file"
        loop
        crossOrigin="anonymous"
        onEnded={() => setPlaying(false)}
      />

      {/* Top bar */}
      <header className="stp-topbar">
        <button className="stp-back" onClick={() => navigate('/dashboard')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          Back
        </button>

        <div className="stp-title-wrap">
          <span className="stp-accent-dot" style={{ background: meta?.color || '#7c3aed' }} />
          <span className="stp-title">Sound Threat Analysis</span>
          <span className="stp-subtitle">Sound.mpeg — Live Audio Monitor</span>
        </div>

        {/* Play / Pause button */}
        <button className={`stp-play-btn ${playing ? 'playing' : ''}`} onClick={handlePlayPause}>
          {playing ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5,3 19,12 5,21"/>
            </svg>
          )}
          {playing ? 'Pause Audio' : 'Play Audio'}
        </button>

        <div className="stp-status-pill" style={{
          background: streamOk ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
          borderColor: streamOk ? '#10b981' : '#ef4444',
        }}>
          <span className="stp-status-dot" style={{ background: streamOk ? '#10b981' : '#ef4444' }} />
          <span style={{ color: streamOk ? '#10b981' : '#ef4444' }}>
            {streamOk ? 'Monitoring' : 'Connection Lost'}
          </span>
        </div>
      </header>

      <main className="stp-grid">
        {/* Left: waveform + current detection */}
        <div className="stp-panel stp-panel--main">
          {/* Current Classification — ONLY show if it's a threat or we are searching */}
          <div className="stp-class-banner" style={{ 
            '--threat-color': current?.threat ? meta?.color : '#64748b',
            opacity: playing ? 1 : 0.7
          }}>
            <div className="stp-class-icon">{current?.threat ? meta?.icon : '🔍'}</div>
            <div className="stp-class-info">
              <span className="stp-class-label">{current?.threat ? 'THREAT DETECTED' : 'SYSTEM STATUS'}</span>
              <span className="stp-class-name" style={{ color: current?.threat ? meta?.color : '#94a3b8' }}>
                {current?.threat ? current.label : (playing ? 'SEARCHING FOR THREATS…' : 'IDLE — PRESS PLAY')}
              </span>
            </div>
            {current?.threat && (
              <div className="stp-conf-block">
                <span className="stp-conf-val">{Math.round(current.conf * 100)}%</span>
                <span className="stp-conf-label">Confidence</span>
              </div>
            )}
          </div>

          {/* Waveform Canvas */}
          <div className="stp-wave-wrap">
            <div className="stp-wave-label">
              LIVE ACOUSTIC MONITORING {!playing && <span style={{color:'rgba(255,255,255,0.3)'}}>— system paused</span>}
            </div>
            <canvas ref={canvasRef} className="stp-canvas" width={800} height={200} />
            {/* Level meter */}
            <div className="stp-rms-bar-wrap">
              <span className="stp-rms-label">INPUT SENSITIVITY</span>
              <div className="stp-rms-track">
                <div className="stp-rms-fill" style={{
                  width: `${level}%`,
                  background: current?.threat ? meta?.color : '#7c3aed',
                  boxShadow: `0 0 10px ${current?.threat ? meta?.color : '#7c3aed'}66`,
                }} />
              </div>
              <span className="stp-rms-val">{Math.round(level)}%</span>
            </div>
          </div>
        </div>

        {/* Right: Alert log */}
        <div className="stp-panel stp-panel--log">
          <div className="stp-panel-hdr">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            THREAT LOG
            <span className="stp-log-badge">{alertLog.length}</span>
          </div>

          <div className="stp-log-list">
            {alertLog.length === 0 ? (
              <div className="stp-empty">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                  <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
                  <path d="M19 10v2a7 7 0 01-14 0v-2"/>
                  <line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
                <p>No threats detected</p>
                <span>The system is currently scanning Sound.mpeg for anomalies.</span>
              </div>
            ) : (
              alertLog.map((ev) => {
                const m = THREAT_META[ev.label] || THREAT_META['Normal'];
                return (
                  <div key={ev.id} className="stp-log-card" style={{ '--card-color': m.color }}>
                    <div className="stp-log-icon">{m.icon}</div>
                    <div className="stp-log-body">
                      <span className="stp-log-type" style={{ color: m.color }}>{ev.label}</span>
                      <span className="stp-log-ts">🕐 {fmt(ev.ts)}</span>
                    </div>
                    <div className="stp-log-conf">{Math.round(ev.conf * 100)}%</div>
                  </div>
                );
              })
            )}
          </div>

          {/* Known threats reference — FILTERED TO ACTIONS ONLY */}
          <div className="stp-legend">
            <div className="stp-legend-title">Actionable Threats</div>
            {Object.entries(THREAT_META).filter(([_, m]) => m.alert).map(([label, m]) => (
              <div key={label} className="stp-legend-row">
                <span className="stp-legend-dot" style={{ background: m.color }} />
                <span className="stp-legend-icon">{m.icon}</span>
                <span className="stp-legend-name" style={{ color: m.color }}>{label}</span>
                <span className="stp-legend-tag">ALARM</span>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
