import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Copy, KeyRound, Lock, ShieldCheck, Trash2, X } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { SkeletonRows } from '@/components/ui';
import { toast } from '@/components/ui/toast';
import { refreshSession } from '@/features/auth/api';
import { useSession } from '@/features/auth/session.store';
import { api, errorMessage } from '@/services/api/client';
import type { Member, Role, SsoConnection } from '@/types';
import { timeAgo } from '@/utils/format';
import { useMembers } from './api';

const PRESETS: { name: string; issuer: string; hint: string }[] = [
  { name: 'Okta', issuer: 'https://YOUR-ORG.okta.com', hint: 'Okta → Applications → Create App Integration → OIDC, Web Application' },
  { name: 'Microsoft Entra ID', issuer: 'https://login.microsoftonline.com/TENANT-ID/v2.0', hint: 'Entra admin center → App registrations → New registration (Web)' },
  { name: 'Google Workspace', issuer: 'https://accounts.google.com', hint: 'Google Cloud console → APIs & Services → Credentials → OAuth client ID (Web)' },
  { name: 'Auth0', issuer: 'https://YOUR-TENANT.auth0.com', hint: 'Auth0 → Applications → Create Application → Regular Web App' },
  { name: 'Keycloak', issuer: 'https://keycloak.example.com/realms/REALM', hint: 'Keycloak → Clients → Create client (OpenID Connect, client authentication on)' },
  { name: 'Other OIDC', issuer: 'https://', hint: 'Any provider that publishes /.well-known/openid-configuration' },
];

/** Admin → Security: require 2FA for the workspace, and single sign-on with an OIDC identity provider. */
export function SecurityPanel() {
  return (
    <div className="int-stack">
      <TwoFactorPolicy />
      <SsoCard />
    </div>
  );
}

function TwoFactorPolicy() {
  const session = useSession()!;
  const qc = useQueryClient();
  const { data: members } = useMembers();
  const { data: org } = useQuery({ queryKey: ['org', 'current'], queryFn: () => api.get<{ require2fa: boolean }>('/organizations/current') });
  const set = useMutation({
    mutationFn: (require2fa: boolean) => api.patch<{ require2fa: boolean; membersWithout2fa: number }>('/organizations/current/security', { require2fa }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['org', 'current'] });
      refreshSession().catch(() => undefined);
      toast.success(r.require2fa ? `2FA is now required${r.membersWithout2fa ? ` — ${r.membersWithout2fa} member(s) will be asked to set it up` : ''}` : '2FA is optional again');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const without = (members ?? []).filter((m: Member) => !m.twoFactorEnabled);
  const required = !!org?.require2fa;
  return (
    <section className="tile int-card">
      <header className="int-head">
        <span className="int-logo mail">
          <ShieldCheck size={22} />
        </span>
        <div>
          <h2>Two-factor authentication</h2>
          <p className="muted small">Require every member to use an authenticator app when signing in with a password. People signing in through SSO are covered by your identity provider instead.</p>
        </div>
        <label className="switch switch-lg ml-auto">
          <input type="checkbox" checked={required} disabled={!org || set.isPending} onChange={() => set.mutate(!required)} aria-label="Require two-factor authentication" />
          <span />
        </label>
      </header>
      {!session.security?.twoFactorEnabled && session.security?.signedInWith !== 'sso' && !required && (
        <p className="small sec-note">Turn on 2FA for your own account first (Settings) — that way you can't lock yourself out.</p>
      )}
      {members ? (
        <div className="sec-members">
          <span className="muted small">
            {members.length - without.length} of {members.length} members have 2FA on
          </span>
          <div className="sec-bar" aria-hidden>
            <span style={{ width: `${members.length ? ((members.length - without.length) / members.length) * 100 : 0}%` }} />
          </div>
          {without.length > 0 && (
            <span className="small">
              Without 2FA: {without.slice(0, 6).map((m) => m.user.name).join(', ')}
              {without.length > 6 ? ` +${without.length - 6}` : ''}
            </span>
          )}
        </div>
      ) : (
        <SkeletonRows rows={1} />
      )}
    </section>
  );
}

type Form = { providerName: string; issuer: string; clientId: string; clientSecret: string; domains: string[]; autoProvision: boolean; defaultRole: Role; enforce: boolean; enabled: boolean };
/** Only the editable fields: the API rejects unknown properties such as id or lastLoginAt. */
const toForm = (c: SsoConnection): Form => ({
  providerName: c.providerName,
  issuer: c.issuer,
  clientId: c.clientId,
  clientSecret: '',
  domains: c.domains,
  autoProvision: c.autoProvision,
  defaultRole: c.defaultRole,
  enforce: c.enforce,
  enabled: c.enabled,
});
const EMPTY: Form = { providerName: 'Okta', issuer: PRESETS[0].issuer, clientId: '', clientSecret: '', domains: [], autoProvision: true, defaultRole: 'MEMBER', enforce: false, enabled: true };

function SsoCard() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['sso'], queryFn: () => api.get<{ connection: SsoConnection | null; redirectUri: string }>('/sso') });
  const [form, setForm] = useState<Form>(EMPTY);
  const [domain, setDomain] = useState('');
  const [editing, setEditing] = useState(false);
  const c = data?.connection;
  useEffect(() => {
    if (c) setForm(toForm(c));
  }, [c]);
  const refresh = () => qc.invalidateQueries({ queryKey: ['sso'] });
  const save = useMutation({
    mutationFn: () => api.raw('PUT', '/sso', { body: { ...form, clientSecret: form.clientSecret || undefined } }),
    onSuccess: () => {
      toast.success('Single sign-on saved');
      setEditing(false);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const test = useMutation({
    mutationFn: () => api.post<{ ok: boolean; keys: number }>('/sso/test'),
    onSuccess: (r) => {
      toast.success(`Connection works — found the provider and ${r.keys} signing key(s)`);
      refresh();
    },
    onError: (e) => {
      toast.error(errorMessage(e));
      refresh();
    },
  });
  const remove = useMutation({ mutationFn: () => api.delete('/sso'), onSuccess: () => { setForm(EMPTY); refresh(); }, onError: (e) => toast.error(errorMessage(e)) });
  const preset = PRESETS.find((p) => p.name === form.providerName) ?? PRESETS[PRESETS.length - 1];
  const addDomain = () => {
    const d = domain.trim().toLowerCase().replace(/^@/, '');
    if (d && !form.domains.includes(d)) setForm({ ...form, domains: [...form.domains, d] });
    setDomain('');
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  if (isLoading || !data) return <SkeletonRows rows={3} />;
  const showForm = !c || editing;

  return (
    <section className="tile int-card">
      <header className="int-head">
        <span className="int-logo github">
          <KeyRound size={22} />
        </span>
        <div>
          <h2>Single sign-on (SSO)</h2>
          <p className="muted small">Let people sign in with your company identity provider over OpenID Connect — Okta, Microsoft Entra ID, Google Workspace, Auth0, Keycloak and more.</p>
        </div>
        {c && (
          <span className={`sec-pill ${c.enabled ? 'ok' : ''} ml-auto`}>{c.enabled ? (c.enforce ? 'Enforced' : 'On') : 'Off'}</span>
        )}
      </header>

      {c && !editing && (
        <div className="int-item">
          <div className="int-row">
            <strong>{c.providerName}</strong>
            <span className="pill pill-soft">{c.domains.join(', ') || 'any domain'}</span>
            <span className="int-health">
              <span className={`health ${c.lastError ? 'bad' : c.lastLoginAt ? 'ok' : ''}`} />
              {c.lastError ? c.lastError : c.lastLoginAt ? `last sign-in ${timeAgo(c.lastLoginAt)}` : 'no sign-ins yet'}
            </span>
            <span className="ml-auto row-tools">
              <button className="btn btn-soft btn-sm" onClick={() => test.mutate()} disabled={test.isPending}>
                <CheckCircle2 size={13} /> Test
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
                Edit
              </button>
              <button className="icon-btn danger" aria-label="Remove SSO" onClick={() => confirm('Remove single sign-on? People will need passwords again.') && remove.mutate()}>
                <Trash2 size={14} />
              </button>
            </span>
          </div>
          <span className="muted small">
            {c.autoProvision ? `New people get the ${c.defaultRole.toLowerCase()} role on first sign-in.` : 'Only existing members can sign in.'} {c.enforce ? 'Password sign-in is off for these domains (owners keep it as break-glass).' : ''}
          </span>
        </div>
      )}

      {showForm && (
        <form className="form int-form sso-form" onSubmit={submit}>
          <div className="preset-row" role="radiogroup" aria-label="Identity provider">
            {PRESETS.map((p) => (
              <button
                type="button"
                key={p.name}
                role="radio"
                aria-checked={form.providerName === p.name}
                className={`chip-btn${form.providerName === p.name ? ' on' : ''}`}
                onClick={() => setForm({ ...form, providerName: p.name, issuer: c && c.providerName === p.name ? c.issuer : p.issuer })}
              >
                {p.name}
              </button>
            ))}
          </div>
          <ol className="int-steps muted small">
            <li>{preset.hint}.</li>
            <li>
              Set the redirect (callback) URI to
              <span className="copy-line">
                <code>{data.redirectUri}</code>
                <button type="button" className="icon-btn" aria-label="Copy redirect URI" onClick={() => navigator.clipboard?.writeText(data.redirectUri).then(() => toast.success('Redirect URI copied'))}>
                  <Copy size={13} />
                </button>
              </span>
            </li>
            <li>Paste the issuer URL, client ID and client secret below. Scopes: openid, email, profile.</li>
          </ol>
          <div className="form-row">
            <label>
              Button label
              <input value={form.providerName} onChange={(e) => setForm({ ...form, providerName: e.target.value })} maxLength={40} required />
            </label>
            <label>
              Issuer URL
              <input value={form.issuer} onChange={(e) => setForm({ ...form, issuer: e.target.value })} placeholder="https://your-org.okta.com" required />
            </label>
          </div>
          <div className="form-row">
            <label>
              Client ID
              <input value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} required autoComplete="off" />
            </label>
            <label>
              Client secret {c && <span className="muted small">(leave empty to keep)</span>}
              <input type="password" value={form.clientSecret} onChange={(e) => setForm({ ...form, clientSecret: e.target.value })} required={!c} autoComplete="new-password" />
            </label>
          </div>
          <label className="block-label">
            Email domains
            <span className="domain-chips">
              {form.domains.map((d) => (
                <span key={d} className="pill pill-soft">
                  @{d}
                  <button type="button" className="icon-btn" aria-label={`Remove ${d}`} onClick={() => setForm({ ...form, domains: form.domains.filter((x) => x !== d) })}>
                    <X size={11} />
                  </button>
                </span>
              ))}
              <input
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    addDomain();
                  }
                }}
                onBlur={addDomain}
                placeholder="acme.com ↵"
                aria-label="Add email domain"
              />
            </span>
            <span className="muted small">People with these addresses see “Continue with {form.providerName || 'SSO'}” on the sign-in page.</span>
          </label>
          <div className="form-row">
            <label className="check">
              <input type="checkbox" checked={form.autoProvision} onChange={(e) => setForm({ ...form, autoProvision: e.target.checked })} /> Create accounts on first sign-in
            </label>
            <label>
              as
              <select value={form.defaultRole} onChange={(e) => setForm({ ...form, defaultRole: e.target.value as Role })} disabled={!form.autoProvision}>
                <option value="MEMBER">Member</option>
                <option value="VIEWER">Viewer</option>
                <option value="ADMIN">Admin</option>
              </select>
            </label>
          </div>
          <label className="check">
            <input type="checkbox" checked={form.enforce} onChange={(e) => setForm({ ...form, enforce: e.target.checked })} /> <Lock size={13} /> Require SSO for these domains (turns off password sign-in; owners keep it as break-glass)
          </label>
          <label className="check">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> Enabled
          </label>
          <div className="row-actions">
            <button className="btn btn-volt" disabled={save.isPending}>
              Save
            </button>
            {c && (
              <button type="button" className="btn btn-ghost" onClick={() => { setEditing(false); setForm(toForm(c)); }}>
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
