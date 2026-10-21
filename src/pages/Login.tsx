import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import { notify } from '../lib/errors';
import { Eye, EyeOff } from 'lucide-react';
import { BrandLogo, Button, Field, Input } from '../components/ui';

export function Login() {
  const { session, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'login' | 'forgot'>('login');
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  if (!loading && session) return <Navigate to={from} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    if (mode === 'login') {
      const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      setBusy(false);
      if (err) {
        setError(/invalid/i.test(err.message) ? 'Incorrect email or password.' : 'Sign-in failed. Please try again.');
        return;
      }
      navigate(from, { replace: true });
    } else {
      await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/reset-password` });
      setBusy(false);
      // Same message whether or not the account exists (no user enumeration).
      notify.success('If that email has an account, a reset link has been sent.');
      setMode('login');
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas p-6">
      <form onSubmit={submit} className="w-full max-w-[400px] animate-rise space-y-4 rounded-2xl border border-line bg-white p-8 shadow-soft">
        <div className="flex justify-center pb-2">
          <BrandLogo className="h-12" />
        </div>
        <div className="text-center">
          <h1 className="text-xl font-semibold text-navy-800">{mode === 'login' ? 'Logistics Control Tower' : 'Reset password'}</h1>
          <p className="mt-1 text-sm text-muted">{mode === 'login' ? 'Sign in with the account your admin created for you.' : 'We will email you a reset link.'}</p>
        </div>
        <Field label="Email">
          <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        {mode === 'login' && (
          <Field label="Password">
            <div className="relative">
              <Input type={show ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="pr-10" />
              <button type="button" onClick={() => setShow(!show)} className="absolute right-2 top-1.5 rounded p-1 text-muted hover:text-ink" aria-label={show ? 'Hide password' : 'Show password'}>
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </Field>
        )}
        {error && <p className="rounded-lg bg-err/10 px-3 py-2 text-sm text-err" role="alert">{error}</p>}
        <Button type="submit" variant="primary" className="w-full !bg-navy-600 py-2 hover:!bg-navy-700" loading={busy}>
          {mode === 'login' ? 'Sign in' : 'Send reset link'}
        </Button>
        <div className="text-center">
          <button type="button" className="text-sm text-navy-600 hover:underline" onClick={() => setMode(mode === 'login' ? 'forgot' : 'login')}>
            {mode === 'login' ? 'Forgot password?' : 'Back to sign in'}
          </button>
        </div>
      </form>
      <p className="mt-6 text-xs text-muted">Authorised Ikris staff only. Activity is logged.</p>
    </div>
  );
}
