import { FormEvent, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { Spinner } from '@/components/ui';
import { errorMessage } from '@/services/api/client';
import { useLogin, useRegister } from './api';
import { useSession } from './session.store';

function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
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

export function LoginPage() {
  const session = useSession();
  const location = useLocation();
  const login = useLogin();
  const [email, setEmail] = useState('demo@workora.dev');
  const [password, setPassword] = useState('workora123');
  if (session) return <Navigate to={(location.state as any)?.from ?? '/'} replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate({ email, password });
  };

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to your workspace">
      <form className="form" onSubmit={submit}>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {login.isError && <div className="form-error">{errorMessage(login.error)}</div>}
        <button className="btn btn-ink btn-block btn-lg" disabled={login.isPending}>
          {login.isPending ? <Spinner /> : 'Sign in'}
        </button>
      </form>
      <p className="muted small">
        New to Workora? <Link to="/register">Create a workspace</Link>
      </p>
      <p className="hint">Demo: demo@workora.dev / workora123 (also rahul@, priya@, viewer@)</p>
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
  return <>{children}</>;
}
