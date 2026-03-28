import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './Login.css';

// Default credentials
const DEFAULT_EMAIL = 'guardai@gmail.com';
const DEFAULT_PASSWORD = 'guardai@123';

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!email || !password) {
      setError('Please enter both email and password.');
      return;
    }

    setLoading(true);
    await new Promise((r) => setTimeout(r, 800));

    if (email === DEFAULT_EMAIL && password === DEFAULT_PASSWORD) {
      setLoading(false);
      navigate('/dashboard');
    } else {
      setLoading(false);
      setError('Invalid credentials. Check the hint below.');
    }
  };

  return (
    <div className="login-page">
      {/* Animated background */}
      <div className="login-bg">
        <div className="login-grid" />
        <div className="login-orb login-orb--1" />
        <div className="login-orb login-orb--2" />
        <div className="login-orb login-orb--3" />
        <div className="login-particles" />
      </div>

      {/* Login card */}
      <div className="login-card">
        {/* Logo */}
        <div className="login-logo">
          <div className="login-logo-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                 strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          <h1>GuardAI</h1>
          <p>Intelligent Surveillance Platform</p>
        </div>

        {/* Error */}
        {error && (
          <div className="login-error">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
            {error}
          </div>
        )}

        {/* Form */}
        <form className="login-form" onSubmit={handleSubmit}>
          {/* Email */}
          <div className="login-field">
            <label htmlFor="login-email">Email Address</label>
            <div className="login-input-wrap">
              <svg className="login-input-icon" viewBox="0 0 24 24"
                   fill="none" stroke="currentColor" strokeWidth="2"
                   strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="4" />
                <path d="M20 21a8 8 0 10-16 0" />
              </svg>
              <input
                id="login-email"
                className="login-input"
                type="email"
                placeholder="guardai@gmail.com"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>

          {/* Password */}
          <div className="login-field">
            <label htmlFor="login-password">Password</label>
            <div className="login-input-wrap">
              <svg className="login-input-icon" viewBox="0 0 24 24"
                   fill="none" stroke="currentColor" strokeWidth="2"
                   strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0110 0v4" />
              </svg>
              <input
                id="login-password"
                className="login-input"
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••••"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="login-pass-toggle"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                       stroke="currentColor" strokeWidth="2">
                    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                       stroke="currentColor" strokeWidth="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* Forgot password */}
          <div className="login-forgot-row">
            <button type="button" className="login-forgot">
              Forgot Password?
            </button>
          </div>

          {/* Submit */}
          <button type="submit" className="login-submit" disabled={loading}>
            <span className="login-submit-content">
              {loading ? (
                <>
                  <span className="login-spinner" />
                  Authenticating...
                </>
              ) : (
                <>
                  Access Dashboard
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                       stroke="currentColor" strokeWidth="2.5"
                       strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </>
              )}
            </span>
          </button>
        </form>

        {/* Security badge */}
        <div className="login-security">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          End-to-End Encrypted · AI-Powered Security
        </div>

        {/* Credentials hint */}
        <div className="login-hint">
          <strong>guardai@gmail.com</strong>&nbsp;/&nbsp;<strong>guardai@123</strong>
        </div>
      </div>
    </div>
  );
}
