import { useNavigate } from 'react-router-dom';
import './Home.css';

const FEATURES = [
  {
    id: 'cam1',
    route: '/dashboard/cam1',
    icon: '🎥',
    title: 'Face Recognition and Intrusion Detection',
    desc: 'Live RTSP feed with real-time person tracking and zone breach alerts',
    color: '#2563eb',
    badge: 'LIVE',
    badgeColor: '#16a34a',
  },
  {
    id: 'tailgating',
    route: '/dashboard/tailgating',
    icon: '🚶',
    title: 'Tailgating Detection',
    desc: 'Detect unauthorized entry following. AI-powered proximity analysis',
    color: '#0891b2',
    badge: 'LIVE',
    badgeColor: '#16a34a',
  },
  {
    id: 'face',
    route: '/dashboard/face',
    icon: '👤',
    title: 'Weapon Detection',
    desc: 'Real-time detection of firearms and other distinct threats',
    color: '#dc2626',
    badge: 'PENDING',
    badgeColor: '#94a3b8',
  },
  {
    id: 'crowd',
    route: '/dashboard/crowd',
    icon: '🚘',
    title: 'Vehicle Number Plate Analysis',
    desc: 'Live ANPR feed with real-time plate detection, bounding boxes, and vehicle attributes',
    color: '#d97706',
    badge: 'LIVE',
    badgeColor: '#16a34a',
  },
  {
    id: 'perimeter',
    route: '/dashboard/perimeter',
    icon: '🔐',
    title: 'Sound Threat Analysis',
    desc: 'Acoustic monitoring for glass break, screams, and gunshots',
    color: '#7c3aed',
    badge: 'PENDING',
    badgeColor: '#94a3b8',
  },
];

export default function Home() {
  const navigate = useNavigate();

  return (
    <div className="home-page">
      {/* Top bar */}
      <header className="home-topbar">
        <div className="home-brand">
          <div className="home-logo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="20" height="12" rx="2" />
              <path d="M12 16v4M8 20h8" />
            </svg>
          </div>
          <span>GuardAI</span>
        </div>
        <button className="home-logout" onClick={() => navigate('/')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="2.5">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          Log Out
        </button>
      </header>

      {/* Hero */}
      <div className="home-hero">
        <h1>Surveillance Command Center</h1>
        <p>Select a module to begin monitoring</p>
      </div>

      {/* 5 Feature Cards */}
      <div className="home-grid">
        {FEATURES.map((f) => (
          <button
            key={f.id}
            className="home-card"
            style={{ '--card-color': f.color }}
            onClick={() => navigate(f.route)}
          >
            <div className="home-card-badge"
                 style={{ background: `${f.badgeColor}22`, color: f.badgeColor,
                          border: `1px solid ${f.badgeColor}44` }}>
              {f.badge}
            </div>
            <div className="home-card-icon"
                 style={{ background: `${f.color}15`, color: f.color }}>
              {f.icon}
            </div>
            <h2 className="home-card-title">{f.title}</h2>
            <p className="home-card-desc">{f.desc}</p>
            <div className="home-card-arrow">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="2.5">
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
              Open module
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
