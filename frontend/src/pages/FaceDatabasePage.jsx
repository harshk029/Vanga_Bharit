import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { wsService } from '../services/websocket';
import './FaceDatabasePage.css';

export default function FaceDatabasePage() {
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [residents, setResidents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [status, setStatus] = useState({ type: '', msg: '' });
  const [liveIdentity, setLiveIdentity] = useState('Initializing Recognition...');

  useEffect(() => {
    fetchResidents();
    startWebcam();
    const interval = setInterval(performLiveRecognition, 2000);
    return () => {
      stopWebcam();
      clearInterval(interval);
    };
  }, []);

  const performLiveRecognition = async () => {
    if (loading || !videoRef.current) return;
    try {
      const video = videoRef.current;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      const b64 = canvas.toDataURL('image/jpeg', 0.8);

      const res = await fetch('/resident/recognize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: b64 }),
      });
      const data = await res.json();
      setLiveIdentity(data.name);
    } catch (e) {}
  };

  const fetchResidents = async () => {
    try {
      const res = await fetch('/residents');
      const data = await res.json();
      if (Array.isArray(data)) {
        setResidents(data);
      } else {
        console.error('Database Error:', data.error);
        setStatus({ type: 'error', msg: 'Database Connection Error: Please configure PostgreSQL.' });
      }
    } catch (e) {
      console.error('Failed to fetch residents', e);
      setStatus({ type: 'error', msg: 'Failed to communicate with DB backend.' });
    }
  };

  const startWebcam = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (e) {
      setStatus({ type: 'error', msg: 'Could not access webcam' });
    }
  };

  const stopWebcam = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(t => t.stop());
    }
  };

  const handleRegister = async () => {
    if (!name.trim()) {
      setStatus({ type: 'error', msg: 'Please enter a name' });
      return;
    }
    setLoading(true);
    setStatus({ type: 'info', msg: 'Capturing and processing face...' });

    try {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));

      const formData = new FormData();
      formData.append('image', blob);
      formData.append('name', name);

      const res = await fetch('/resident/register', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();

      if (data.success) {
        setStatus({ type: 'success', msg: `Registered ${name} successfully!` });
        setName('');
        fetchResidents();
      } else {
        setStatus({ type: 'error', msg: data.error || 'Registration failed' });
      }
    } catch (e) {
      setStatus({ type: 'error', msg: 'Server error during registration' });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this resident?')) return;
    try {
      await fetch(`/resident/${id}`, { method: 'DELETE' });
      fetchResidents();
    } catch (e) {
      console.error('Delete failed', e);
    }
  };

  return (
    <div className="fd-page">
      <header className="fd-header">
        <button className="fd-back" onClick={() => navigate('/dashboard')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          Back
        </button>
        <div className="fd-title-group">
          <h1>Face Database Recognizer</h1>
          <p>ArcFace Biometrics & PostgreSQL Storage</p>
        </div>
        <div className="fd-status-badge">Postgres Connected</div>
      </header>

      <main className="fd-content">
        {/* Left: Registration */}
        <div className="fd-card fd-reg-card">
          <div className="fd-card-hdr">
            <span className="fd-icon">📸</span>
            Register New Resident
          </div>
          <div className="fd-webcam-wrap">
            <video ref={videoRef} autoPlay muted playsInline className="fd-video" />
            <canvas ref={canvasRef} style={{ display: 'none' }} />
            <div className={`fd-identity-badge ${liveIdentity.includes('Resident') ? 'is-resident' : ''}`}>
              {liveIdentity}
            </div>
            {loading && <div className="fd-overlay">Analyzing Facemarkers...</div>}
          </div>
          <div className="fd-form">
            <input 
              type="text" 
              placeholder="Enter Resident Name" 
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={loading}
            />
            <button className="fd-btn-reg" onClick={handleRegister} disabled={loading}>
              {loading ? 'Processing...' : 'Register & Save to DB'}
            </button>
          </div>
          {status.msg && (
            <div className={`fd-status fd-status--${status.type}`}>
              {status.msg}
            </div>
          )}
        </div>

        {/* Right: Database */}
        <div className="fd-card fd-db-card">
          <div className="fd-card-hdr">
            <span className="fd-icon">📋</span>
            Resident Database
            <span className="fd-count">{residents.length}</span>
          </div>
          <div className="fd-list">
            {residents.length === 0 ? (
              <div className="fd-empty">No residents registered yet</div>
            ) : (
              residents.map(r => (
                <div key={r.id} className="fd-item">
                  <div className="fd-item-info">
                    <span className="fd-item-name">{r.name}</span>
                    <span className="fd-item-date">{new Date(r.created_at).toLocaleDateString()}</span>
                  </div>
                  <button className="fd-btn-del" onClick={() => handleDelete(r.id)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                    </svg>
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
