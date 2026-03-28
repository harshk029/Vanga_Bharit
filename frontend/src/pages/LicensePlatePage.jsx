import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import './LicensePlatePage.css';

const REGION_FLAGS = {
  GB: '🇬🇧', US: '🇺🇸', DE: '🇩🇪', FR: '🇫🇷', IT: '🇮🇹',
  ES: '🇪🇸', NL: '🇳🇱', BE: '🇧🇪', IN: '🇮🇳', AU: '🇦🇺',
  CA: '🇨🇦', CN: '🇨🇳', JP: '🇯🇵', HK: '🇭🇰', SG: '🇸🇬',
};

const VEHICLE_ICONS = {
  Sedan: '🚗', SUV: '🚙', Van: '🚐', Bus: '🚌',
  Truck: '🚚', 'Pickup Truck': '🛻', Motorcycle: '🏍️',
};

function fmt(ts) {
  return new Date(ts * 1000).toLocaleTimeString();
}

function ConfidenceBar({ value }) {
  const pct = Math.round(value * 100);
  const color = pct >= 90 ? '#10b981' : pct >= 70 ? '#f59e0b' : '#ef4444';
  return (
    <div className="lpp-conf-bar-wrap">
      <div className="lpp-conf-bar" style={{ width: `${pct}%`, background: color }} />
      <span className="lpp-conf-pct" style={{ color }}>{pct}%</span>
    </div>
  );
}

export default function LicensePlatePage() {
  const navigate = useNavigate();
  const [plates, setPlates]       = useState({}); // plate_text -> info
  const [activeId, setActiveId]   = useState(null);
  const [feedKey, setFeedKey]     = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [streamOk, setStreamOk]   = useState(true);
  const [playing, setPlaying]     = useState(false);
  const listRef = useRef(null);
  const evsRef  = useRef(null);
  const audioRef = useRef(null);

  // Subscribe to SSE plate detections
  useEffect(() => {
    const es = new EventSource('/plate_detections');
    evsRef.current = es;

    es.onmessage = (e) => {
      try {
        const det = JSON.parse(e.data);
        if (!det.plate) return;
        setPlates(prev => {
          const next = { ...prev, [det.plate]: det };
          return next;
        });
        setTotalCount(c => c + 1);
        setActiveId(det.plate);
      } catch (_) {}
    };

    es.onerror = () => setStreamOk(false);

    return () => es.close();
  }, []);

  // Auto-scroll plates list when new entry
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = 0; // newest on top
    }
  }, [plates]);

  const sortedPlates = Object.values(plates)
    .filter(p => p.score >= 0.85) // ONLY 85% + Confidence
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const uniqueCount  = sortedPlates.length;
  const highConf     = sortedPlates.filter(p => p.score >= 0.95).length;

  return (
    <div className="lpp-page">
      {/* ── Top bar ── */}
      <header className="lpp-topbar">
        <button className="lpp-back" onClick={() => navigate('/dashboard')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="2.5">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          Back
        </button>

        <div className="lpp-title-wrap">
          <span className="lpp-accent-dot" />
          <span className="lpp-title">Vehicle Number Plate Analysis</span>
          <span className="lpp-subtitle">CAM 04 — ANPR Live Feed</span>
        </div>

        <div className="lpp-status-pill" style={{ background: streamOk ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)', borderColor: streamOk ? '#10b981' : '#ef4444' }}>
          <span className="lpp-status-dot" style={{ background: streamOk ? '#10b981' : '#ef4444' }} />
          <span style={{ color: streamOk ? '#10b981' : '#ef4444' }}>
            {streamOk ? 'Live Scanning' : 'Connection Lost'}
          </span>
        </div>
      </header>

      {/* ── Main grid ── */}
      <main className="lpp-grid">

        {/* ── Left: Video feed ── */}
        <div className="lpp-panel lpp-panel--video">
          <div className="lpp-panel-hdr">
            <span className="lpp-rec-dot" />
            <span>LIVE ANPR FEED</span>
            <span className="lpp-hdr-cam">CAM 04 · Plate.mp4</span>
            
            <div className="lpp-hdr-actions">
              <button 
                className={`lpp-audio-btn ${playing ? 'playing' : ''}`} 
                onClick={() => {
                  const audio = audioRef.current;
                  if (audio.paused) { audio.play(); setPlaying(true); }
                  else { audio.pause(); setPlaying(false); }
                }}
                title={playing ? "Mute Audio" : "Play Audio"}
              >
                {playing ? '🔊' : '🔇'}
              </button>

              <button className="lpp-reload-btn" onClick={() => setFeedKey(k => k + 1)} title="Reload stream">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="23 4 23 10 17 10"/>
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                </svg>
              </button>
            </div>
          </div>

          <audio ref={audioRef} src="/plate_audio" loop />

          <div className="lpp-feed">
            <img key={feedKey} src="/video_feed_4" alt="License Plate Live Feed" className="lpp-feed-img" draggable={false} />
            <div className="lpp-feed-overlay">
              <div className="lpp-overlay-stat">
                <span className="lpp-overlay-val">{uniqueCount}</span>
                <span className="lpp-overlay-label">Unique Plates</span>
              </div>
              <div className="lpp-overlay-div" />
              <div className="lpp-overlay-stat">
                <span className="lpp-overlay-val">{highConf}</span>
                <span className="lpp-overlay-label">High Confidence</span>
              </div>
              <div className="lpp-overlay-div" />
              <div className="lpp-overlay-stat">
                <span className="lpp-overlay-val">{totalCount}</span>
                <span className="lpp-overlay-label">Total Reads</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Right: Plate panel ── */}
        <div className="lpp-panel lpp-panel--plates">
          <div className="lpp-panel-hdr">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.5">
              <rect x="2" y="7" width="20" height="10" rx="2"/>
              <path d="M7 12h10"/>
            </svg>
            DETECTED PLATES
            <span className="lpp-plate-badge">{uniqueCount}</span>
          </div>

          <div className="lpp-plate-list" ref={listRef}>
            {sortedPlates.length === 0 ? (
              <div className="lpp-empty">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                  <rect x="2" y="7" width="20" height="10" rx="2"/>
                  <path d="M7 12h10"/>
                </svg>
                <p>Scanning for plates…</p>
                <span>Bounding boxes will appear on the feed when a plate is detected</span>
              </div>
            ) : (
              sortedPlates.map((p) => {
                const isActive = p.plate === activeId;
                const flag = REGION_FLAGS[p.region] || '🌐';
                const vIcon = VEHICLE_ICONS[p.vehicle_type] || '🚗';
                return (
                  <div
                    key={p.plate}
                    className={`lpp-plate-card ${isActive ? 'lpp-plate-card--active' : ''}`}
                    onClick={() => setActiveId(p.plate === activeId ? null : p.plate)}
                  >
                    {/* Plate Text header */}
                    <div className="lpp-card-top">
                      <div className="lpp-plate-text">{p.plate}</div>
                      <span className="lpp-flag">{flag}</span>
                      <span className="lpp-vehicle-icon">{vIcon}</span>
                    </div>

                    {/* Confidence bar */}
                    <ConfidenceBar value={p.score} />

                    {/* Info grid */}
                    <div className="lpp-info-grid">
                      <div className="lpp-info-item">
                        <span className="lpp-info-label">Region</span>
                        <span className="lpp-info-val">{p.region || '—'}</span>
                      </div>
                      <div className="lpp-info-item">
                        <span className="lpp-info-label">Vehicle</span>
                        <span className="lpp-info-val">{p.vehicle_type || '—'}</span>
                      </div>
                      {p.color && (
                        <div className="lpp-info-item">
                          <span className="lpp-info-label">Color</span>
                          <span className="lpp-info-val" style={{ textTransform: 'capitalize' }}>{p.color}</span>
                        </div>
                      )}
                      {p.make_model && p.make_model.trim() && (
                        <div className="lpp-info-item">
                          <span className="lpp-info-label">Make/Model</span>
                          <span className="lpp-info-val">{p.make_model}</span>
                        </div>
                      )}
                    </div>

                    {/* Alt reads */}
                    {p.alternatives && p.alternatives.length > 0 && (
                      <div className="lpp-alt-reads">
                        <span className="lpp-alt-label">Also:</span>
                        {p.alternatives.map(a => (
                          <span key={a} className="lpp-alt-chip">{a}</span>
                        ))}
                      </div>
                    )}

                    {/* Timestamp */}
                    <div className="lpp-card-footer">
                      <span className="lpp-ts">🕐 {fmt(p.ts)}</span>
                      <span className={`lpp-dscore ${p.dscore >= 0.8 ? 'lpp-dscore--hi' : ''}`}>
                        Det: {Math.round(p.dscore * 100)}%
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Stats footer */}
          <div className="lpp-stats-bar">
            <div className="lpp-stat">
              <strong>{uniqueCount}</strong>
              <span>Unique</span>
            </div>
            <div className="lpp-stat-div"/>
            <div className="lpp-stat">
              <strong>{highConf}</strong>
              <span>≥90% conf</span>
            </div>
            <div className="lpp-stat-div"/>
            <div className="lpp-stat">
              <strong>{sortedPlates.filter(p => p.region === 'GB').length}</strong>
              <span>🇬🇧 GB</span>
            </div>
            <div className="lpp-stat-div"/>
            <div className="lpp-stat">
              <strong>{totalCount}</strong>
              <span>Total Reads</span>
            </div>
          </div>
        </div>

      </main>
    </div>
  );
}
