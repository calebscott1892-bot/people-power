import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import BackButton from '@/components/shared/BackButton';

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signIn, signUp, isSupabaseConfigured, authErrorMessage } = useAuth();
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setStatus('');
    setLoading(true);

    try {
      if (mode === 'signup') {
        await signUp(email, password);
        setStatus('Signup complete. If email confirmation is enabled, check your inbox.');
      } else {
        await signIn(email, password);
        const rawFrom = location.state?.from;
        const to =
          typeof rawFrom === 'string'
            ? rawFrom
            : rawFrom?.pathname
              ? `${rawFrom.pathname}${rawFrom.search ?? ''}${rawFrom.hash ?? ''}`
              : '/';
        navigate(to, { replace: true });
      }
    } catch (err) {
      setStatus(err?.message ?? 'Auth error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 420, border: '2px solid #e2e8f0', borderRadius: 18, padding: 20 }}>
        <h1 style={{ fontSize: 28, fontWeight: 900, marginBottom: 8 }}>
          {mode === 'signup' ? 'Create account' : 'Login'}
        </h1>
        <p style={{ marginBottom: 16, color: '#64748b', fontWeight: 600 }}>
          Supabase Auth (email + password)
        </p>

        <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
          <label style={{ display: 'grid', gap: 6, fontWeight: 800 }}>
            Email
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
              style={{ padding: 12, borderRadius: 12, border: '2px solid #cbd5e1' }}
            />
          </label>

          <label style={{ display: 'grid', gap: 6, fontWeight: 800 }}>
            Password
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              required
              minLength={6}
              style={{ padding: 12, borderRadius: 12, border: '2px solid #cbd5e1' }}
            />
          </label>

          <button
            disabled={loading || !isSupabaseConfigured}
            style={{
              padding: 12,
              borderRadius: 12,
              border: '0',
              background: '#3A3DFF',
              color: 'white',
              fontWeight: 900,
              cursor: 'pointer',
              opacity: loading || !isSupabaseConfigured ? 0.7 : 1
            }}
          >
            {loading ? 'Working…' : mode === 'signup' ? 'Sign up' : 'Login'}
          </button>

          {!isSupabaseConfigured ? (
            <div style={{ color: '#b91c1c', fontWeight: 800 }}>
              {authErrorMessage || 'Sign-in is temporarily unavailable.'}
            </div>
          ) : null}

          {status ? <div style={{ color: '#b91c1c', fontWeight: 800 }}>{status}</div> : null}

          <button
            type="button"
            onClick={() => setMode(mode === 'signup' ? 'login' : 'signup')}
            style={{ background: 'transparent', border: 0, color: '#3A3DFF', fontWeight: 900, cursor: 'pointer' }}
          >
            {mode === 'signup' ? 'Already have an account? Login' : 'New here? Create an account'}
          </button>

          <BackButton
            className="inline-flex items-center justify-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-700"
            iconClassName="w-4 h-4"
          />
        </form>
      </div>
    </div>
  );
}
