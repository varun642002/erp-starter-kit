import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, Clock, LogOut, RefreshCw, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

type Mode = 'signin' | 'signup' | 'reset';

const inputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-white';

const Shell: React.FC<{ title: string; subtitle: string; children: React.ReactNode }> = ({
  title,
  subtitle,
  children
}) => (
  <div className="flex min-h-screen w-screen items-center justify-center bg-slate-50 p-4 dark:bg-slate-950">
    <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-800 text-white">
          <ShieldCheck className="h-4 w-4" />
        </div>
        <div>
          <h1 className="text-base font-bold tracking-tight text-slate-900 dark:text-white">{title}</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
        </div>
      </div>
      {children}
    </div>
  </div>
);

const LoginScreen: React.FC = () => {
  const { signInWithEmail, signUpWithEmail, signInWithGoogle, resetPassword, authError, clearAuthError } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const switchMode = (next: Mode) => {
    clearAuthError();
    setResetSent(false);
    setMode(next);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === 'signin') {
        await signInWithEmail(email, password);
      } else if (mode === 'signup') {
        await signUpWithEmail(email, password, name);
      } else {
        await resetPassword(email);
        setResetSent(true);
      }
    } catch {
      // surfaced through authError
    } finally {
      setBusy(false);
    }
  };

  const googleSignIn = async () => {
    setBusy(true);
    try {
      await signInWithGoogle();
    } catch {
      // surfaced through authError
    } finally {
      setBusy(false);
    }
  };

  const titles: Record<Mode, string> = {
    signin: 'Sign in to ERP Starter Kit',
    signup: 'Create your account',
    reset: 'Reset your password'
  };
  const subtitles: Record<Mode, string> = {
    signin: 'Use your work email and password.',
    signup: 'An administrator must approve your account before you can use the ERP.',
    reset: 'We will email you a link to choose a new password.'
  };

  return (
    <Shell title={titles[mode]} subtitle={subtitles[mode]}>
      {authError && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{authError}</span>
        </div>
      )}
      {resetSent && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-300">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>If an account exists for that email, a reset link is on its way.</span>
        </div>
      )}

      <form onSubmit={submit} className="space-y-3">
        {mode === 'signup' && (
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">Full name</label>
            <input
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              required
              maxLength={100}
            />
          </div>
        )}
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">Email</label>
          <input
            type="email"
            className={inputClass}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </div>
        {mode !== 'reset' && (
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">Password</label>
            <input
              type="password"
              className={inputClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              required
              minLength={6}
            />
          </div>
        )}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-slate-800 py-2.5 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-50"
        >
          {busy ? 'Please wait...' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
        </button>
      </form>

      {mode !== 'reset' && (
        <>
          <div className="my-4 flex items-center gap-3 text-[11px] text-slate-400">
            <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
            or
            <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
          </div>
          <button
            type="button"
            onClick={googleSignIn}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-slate-300 bg-white py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:hover:bg-slate-700"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
            </svg>
            Continue with Google
          </button>
        </>
      )}

      <div className="mt-4 flex items-center justify-between text-xs">
        {mode === 'signin' ? (
          <>
            <button className="font-semibold text-slate-700 hover:underline dark:text-slate-300" onClick={() => switchMode('signup')}>
              Create account
            </button>
            <button className="text-slate-500 hover:underline" onClick={() => switchMode('reset')}>
              Forgot password?
            </button>
          </>
        ) : (
          <button className="font-semibold text-slate-700 hover:underline dark:text-slate-300" onClick={() => switchMode('signin')}>
            Back to sign in
          </button>
        )}
      </div>
    </Shell>
  );
};

export const AuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { firebaseUser, userProfile, loading, profileError, isApproved, signOutUser, refreshProfile } = useAuth();
  const [checking, setChecking] = useState(false);

  const recheck = async () => {
    setChecking(true);
    try {
      await refreshProfile();
    } finally {
      setChecking(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen w-screen items-center justify-center bg-slate-50 text-sm text-slate-500 dark:bg-slate-950">
        Loading...
      </div>
    );
  }

  if (!firebaseUser) {
    return <LoginScreen />;
  }

  if (profileError || !userProfile) {
    return (
      <Shell title="Account unavailable" subtitle={firebaseUser.email || ''}>
        <p className="mb-4 text-xs text-slate-600 dark:text-slate-400">
          {profileError || 'Loading your account profile...'}
        </p>
        <div className="flex gap-2">
          <button onClick={recheck} disabled={checking} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-slate-800 py-2 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-50">
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </button>
          <button onClick={signOutUser} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-300 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300">
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      </Shell>
    );
  }

  if (!isApproved) {
    return (
      <Shell title="Waiting for approval" subtitle={firebaseUser.email || ''}>
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-300">
          <Clock className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Your account has been created. A Super Admin needs to approve it and assign your role and branch before you
            can use the ERP.
          </span>
        </div>
        <div className="flex gap-2">
          <button onClick={recheck} disabled={checking} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-slate-800 py-2 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${checking ? 'animate-spin' : ''}`} /> Check again
          </button>
          <button onClick={signOutUser} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-300 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300">
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      </Shell>
    );
  }

  return <>{children}</>;
};
