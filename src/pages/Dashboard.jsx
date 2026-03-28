import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { wsService } from '../services/websocket';
import './Dashboard.css';

export default function Dashboard() {
  const navigate = useNavigate();
  const [wsStatus, setWsStatus] = useState('disconnected');
  const [alerts, setAlerts] = useState([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const logRef = useRef(null);
  const feedRef = useRef(null);

  useEffect(() => {
    const unsubStatus = wsService.onStatusChange(setWsStatus);
    const unsubMsg = wsService.onMessage((data) => {
      if (data?.level === 'alert') {
        setAlerts((prev) => [...prev, { ...data, id: Date.now() }].slice(-100));
      }
    });
    wsService.connect();
    return () => { unsubStatus(); unsubMsg(); wsService.disconnect(); };
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [alerts]);

  const handleLogout = () => { wsService.disconnect(); navigate('/'); };

  const toggleFullscreen = useCallback(() => setIsFullscreen((f) => !f), []);

  const statusStyle = {
    connected:    { bg: '#10b981', shadow: 'rgba(16,185,129,0.5)', label: 'System Online' },
    connecting:   { bg: '#f59e0b', shadow: 'rgba(245,158,11,0.5)',  label: 'Connecting...' },
    disconnected: { bg: '#ef4444', shadow: 'rgba(239,68,68,0.5)',   label: 'Offline' },
  }[wsStatus] ?? { bg: '#ef4444', shadow: 'rgba(239,68,68,0.5)', label: 'Offline' };

  return (
    <div className="db-page">
      {/* ── Top bar ── */}
      <header className="db-topbar">
        <div className="db-brand">
          <div className="db-logo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          <span className="db-brand-name">GuardAI</span>
          <span className="db-brand-tag">Surveillance</span>
        </div>

        <div className="db-topbar-right">
          <div className="db-ws-pill">
            <span className="db-ws-dot" style={{
              background: statusStyle.bg,
              boxShadow: `0 0 7px ${statusStyle.shadow}`
            }} />
            <span>{statusStyle.label}</span>
          </div>
          <button className="db-logout-btn" onClick={handleLogout}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2.5">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Log Out
          </button>
        </div>
      </header>

      {/* ── Two-panel grid ── */}
      <main className={`db-grid ${isFullscreen ? 'db-grid--fullscreen' : ''}`}>

        {/* Panel 1 — Live Video Feed */}
        <div className="db-panel db-panel--feed">
          <div className="db-panel-header">
            <div className="db-panel-title">
              <span className="db-rec-dot" />
              LIVE FEED
            </div>
            <span className="db-panel-subtitle">CAM 01 — Main Gate</span>
            <button
              className="db-fullscreen-btn"
              onClick={toggleFullscreen}
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="2">
                  <path d="M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3" />
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="2">
                  <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3" />
                </svg>
              )}
            </button>
          </div>

          <div
            className="db-feed-body"
            ref={feedRef}
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Click to exit fullscreen' : 'Click to fullscreen'}
          >
            <img
              id="surveillance-feed"
              src="/video_feed"
              alt="Live Surveillance Feed"
              className="db-feed-img"
              draggable={false}
            />
            <div className="db-feed-hint">
              {isFullscreen ? 'Click to exit fullscreen' : 'Click to expand'}
            </div>
          </div>
        </div>

        {/* Panel 2 — Security Alerts */}
        <div className={`db-panel db-panel--alerts ${isFullscreen ? 'db-panel--hidden' : ''}`}>
          <div className="db-panel-header">
            <div className="db-panel-title">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                   stroke="#f87171" strokeWidth="2.5">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              SECURITY ALERTS
            </div>
            <span className="db-alert-badge">{alerts.length}</span>
          </div>

          <div className="db-alert-log" ref={logRef}>
            {alerts.length === 0 ? (
              <div className="db-alert-empty">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="1.2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
                <p>No alerts yet</p>
                <span>Monitoring for activity...</span>
              </div>
            ) : (
              alerts.slice().reverse().map((a) => (
                <div key={a.id} className="db-alert-item">
                  <span className="db-alert-emoji">
                    {a.msg?.includes('TRESPASS') ? '🚨' : '⚠️'}
                  </span>
                  <div className="db-alert-body">
                    <span className="db-alert-msg">{a.msg}</span>
                    <span className="db-alert-ts">
                      {new Date(a.ts * 1000).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Stats footer */}
          <div className="db-stats">
            <div className="db-stat">
              <span className="db-stat-val">{alerts.filter(a => a.msg?.includes('TRESPASS')).length}</span>
              <span className="db-stat-label">Trespass</span>
            </div>
            <div className="db-stat-divider" />
            <div className="db-stat">
              <span className="db-stat-val">{alerts.filter(a => a.msg?.includes('LOITER')).length}</span>
              <span className="db-stat-label">Loitering</span>
            </div>
            <div className="db-stat-divider" />
            <div className="db-stat">
              <span className="db-stat-val">{alerts.length}</span>
              <span className="db-stat-label">Total</span>
            </div>
          </div>
        </div>

      </main>
    </div>
  );
}
