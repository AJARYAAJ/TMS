import { KeyRound } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { config } from '@/config';
import { CodeInput, TwoFactorCard } from '@/features/settings/Security';
import { Spinner } from '@/components/ui';
import { api, errorMessage } from '@/services/api/client';
import { refreshSession, useLogin, useRegister, useSecondFactor } from './api';
import { useSession, useSessionStore } from './session.store';

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="auth-page">
      <section className="auth-manifesto" aria-hidden="true">
        <div className="brand brand-lg">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={34} height={34} />
          <span>Workora</span>
        </div>
        <h2 className="manifesto">
          Plan it.
          <br />
          Ship it.
          <br />
          <span className="outline">Together,</span>
          <br />
          in real time.
        </h2>
        <ul className="manifesto-points">
          <li>Boards, sprints, roadmaps & goals</li>
          <li>Live updates — no refresh, ever</li>
          <li>Automations that do the busywork</li>
        </ul>
        <div className="orbs">
          <span />
          <span />
          <span />
        </div>
      </section>
      <section className="auth-form-side">
        <div className="auth-card">
          <h1 className="display-sm">{title}</h1>
          <p className="muted">{subtitle}</p>
          {children}
        </div>
      </section>
    </div>
  );
}

interface SsoHint {
  sso: boolean;
  providerName?: string;
  enforced?: boolean;
  startUrl?: string;
}

export function LoginPage() {
  const session = useSession();
  const location = useLocation();
  const login = useLogin();
  const second = useSecondFactor();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('demo@workora.dev');
  const [password, setPassword] = useState('workora123');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [sso, setSso] = useState<SsoHint | null>(null);
  const [ssoMode, setSsoMode] = useState(false);
  const ssoError = params.get('sso_error');

  // As the email is typed, ask whether its domain signs in through a company identity provider.
  useEffect(() => {
    const value = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return setSso(null);
    const t = setTimeout(() => {
      api.get<SsoHint>('/auth/sso/discover', { email: value }).then(setSso, () => setSso(null));
    }, 300);
    return () => clearTimeout(t);
  }, [email]);

  if (session) return <Navigate to={(location.state as any)?.from ?? '/'} replace />;
  const goSso = () => sso?.startUrl && window.location.assign(sso.startUrl);
  const ssoRequired = (login.error as any)?.code === 'SSO_REQUIRED';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ssoMode) return goSso();
    login.mutate({ email, password }, { onSuccess: (r) => 'mfaRequired' in r && setChallenge(r.mfaToken) });
  };
  const verify = (value = code) => challenge && value && second.mutate({ mfaToken: challenge, code: value });

  if (challenge) {
    return (
      <AuthLayout title="Two-step verification" subtitle={useRecovery ? 'Enter one of your recovery codes.' : 'Enter the 6-digit code from your authenticator app.'}>
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            verify();
          }}
        >
          {useRecovery ? (
            <input className="code-input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="abcd-efgh" aria-label="Recovery code" autoFocus autoComplete="off" />
          ) : (
            <CodeInput value={code} onChange={setCode} onComplete={(v) => verify(v)} autoFocus />
          )}
          {second.isError && <div className="form-error">{errorMessage(second.error)}</div>}
          <button className="btn btn-ink btn-block btn-lg" disabled={second.isPending || !code}>
            {second.isPending ? <Spinner /> : 'Verify'}
          </button>
        </form>
        <p className="muted small">
          <button className="link-btn" onClick={() => { setUseRecovery(!useRecovery); setCode(''); second.reset(); }}>
            {useRecovery ? 'Use your authenticator app' : 'Lost your phone? Use a recovery code'}
          </button>
          {' · '}
          <button className="link-btn" onClick={() => { setChallenge(null); setCode(''); second.reset(); }}>
            Start over
          </button>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to your workspace">
      {ssoError && <div className="form-error">Single sign-on failed: {ssoError}</div>}
      <form className="form" onSubmit={submit}>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </label>
        {sso?.sso && (
          <button type="button" className="btn btn-volt btn-block btn-lg sso-btn" onClick={goSso}>
            <KeyRound size={16} /> Continue with {sso.providerName}
          </button>
        )}
        {!ssoMode && !(sso?.sso && sso.enforced) && (
          <>
            {sso?.sso && <div className="or-divider">or use your password</div>}
            <label>
              Password
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
            </label>
            {login.isError && <div className="form-error">{errorMessage(login.error)}{ssoRequired && sso?.sso ? ' Use the button above.' : ''}</div>}
            <button className="btn btn-ink btn-block btn-lg" disabled={login.isPending}>
              {login.isPending ? <Spinner /> : 'Sign in'}
            </button>
          </>
        )}
        {ssoMode && !sso?.sso && <p className="muted small">Enter your work email — we'll find your company's sign-in.</p>}
      </form>
      <p className="muted small">
        {!sso?.sso && (
          <>
            <button className="link-btn" onClick={() => setSsoMode(!ssoMode)}>
              {ssoMode ? 'Sign in with a password' : 'Sign in with SSO'}
            </button>
            {' · '}
          </>
        )}
        New to Workora? <Link to="/register">Create a workspace</Link>
      </p>
      <p className="hint">Demo: demo@workora.dev / workora123 (also rahul@, priya@, viewer@)</p>
    </AuthLayout>
  );
}

/** Lands here after the identity provider: the session token arrives in the URL fragment. */
export function SsoCallbackPage() {
  const setSession = useSessionStore((s) => s.setSession);
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
    history.replaceState(null, '', window.location.pathname); // drop the token from the address bar
    if (!token) return setError('The sign-in link is incomplete.');
    fetch(`${config.apiBase}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((j) => {
        if (!j?.success) throw new Error(j?.error?.message ?? 'Sign-in failed');
        setSession({ token, ...j.data });
        navigate('/', { replace: true });
      })
      .catch((e) => setError(e.message));
  }, [navigate, setSession]);
  return (
    <AuthLayout title={error ? 'Sign-in failed' : 'Signing you in…'} subtitle={error ?? 'Finishing single sign-on.'}>
      {error ? <Link to="/login">Back to sign in</Link> : <Spinner />}
    </AuthLayout>
  );
}

/** The workspace requires 2FA: until it's on, the app shows only this. */
function MfaGate() {
  const session = useSession()!;
  const signOut = useSessionStore((s) => s.signOut);
  return (
    <AuthLayout title="Turn on two-factor authentication" subtitle={`${session.organization.name} requires it for every member. It takes a minute.`}>
      <TwoFactorCard onEnabled={() => refreshSession().catch(() => undefined)} />
      <p className="muted small">
        <button className="link-btn" onClick={signOut}>
          Sign out
        </button>
      </p>
    </AuthLayout>
  );
}

export function RegisterPage() {
  const session = useSession();
  const register = useRegister();
  const [form, setForm] = useState({ name: '', email: '', password: '', organizationName: '' });
  if (session) return <Navigate to="/" replace />;
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  const details = (register.error as any)?.details as Record<string, string[]> | undefined;

  return (
    <AuthLayout title="Create your workspace" subtitle="Plan, track and ship work together">
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          register.mutate(form);
        }}
      >
        <label>
          Your name
          <input value={form.name} onChange={set('name')} required />
        </label>
        <label>
          Work email
          <input type="email" value={form.email} onChange={set('email')} required />
        </label>
        <label>
          Password
          <input type="password" value={form.password} onChange={set('password')} minLength={8} required />
          {details?.password && <span className="field-error">{details.password[0]}</span>}
        </label>
        <label>
          Organization name
          <input value={form.organizationName} onChange={set('organizationName')} placeholder="Acme Inc" required />
        </label>
        {register.isError && <div className="form-error">{errorMessage(register.error)}</div>}
        <button className="btn btn-ink btn-block btn-lg" disabled={register.isPending}>
          {register.isPending ? <Spinner /> : 'Create workspace'}
        </button>
      </form>
      <p className="muted small">
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </AuthLayout>
  );
}

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const session = useSession();
  const location = useLocation();
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (session.security?.mfaSetupRequired) return <MfaGate />;
  return <>{children}</>;
}
