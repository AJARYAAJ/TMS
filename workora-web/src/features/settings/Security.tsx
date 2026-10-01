import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Download, KeyRound, ShieldCheck, ShieldOff, Smartphone } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { Spinner } from '@/components/ui';
import { toast } from '@/components/ui/toast';
import { refreshSession } from '@/features/auth/api';
import { useSession } from '@/features/auth/session.store';
import { api, errorMessage } from '@/services/api/client';
import type { TwoFactorStatus } from '@/types';
import { formatDate } from '@/utils/format';

const KEY = ['2fa'] as const;

/** Six-digit code input: numeric keyboard on phones, one-time-code autofill, auto-submit when complete. */
export function CodeInput({ value, onChange, onComplete, autoFocus, label = 'Authentication code' }: { value: string; onChange: (v: string) => void; onComplete?: (v: string) => void; autoFocus?: boolean; label?: string }) {
  return (
    <input
      className="code-input"
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]*"
      maxLength={6}
      placeholder="000000"
      aria-label={label}
      autoFocus={autoFocus}
      value={value}
      onChange={(e) => {
        const v = e.target.value.replace(/\D/g, '').slice(0, 6);
        onChange(v);
        if (v.length === 6) onComplete?.(v);
      }}
    />
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const text = codes.join('\n');
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([`Workora recovery codes\nEach code works once.\n\n${text}\n`], { type: 'text/plain' }));
    a.download = 'workora-recovery-codes.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <div className="recovery">
      <p>
        <strong>Save these recovery codes.</strong> Each one signs you in once if you lose your phone. They won't be shown again.
      </p>
      <ol className="recovery-codes" aria-label="Recovery codes">
        {codes.map((c) => (
          <li key={c}>
            <code>{c}</code>
          </li>
        ))}
      </ol>
      <div className="row-actions">
        <button type="button" className="btn btn-soft btn-sm" onClick={() => navigator.clipboard?.writeText(text).then(() => toast.success('Recovery codes copied'))}>
          <Copy size={13} /> Copy
        </button>
        <button type="button" className="btn btn-soft btn-sm" onClick={download}>
          <Download size={13} /> Download .txt
        </button>
        <button type="button" className="btn btn-volt btn-sm ml-auto" onClick={onDone}>
          I've saved them
        </button>
      </div>
    </div>
  );
}

/** Two-factor authentication: status, guided setup, recovery codes, turn off. */
export function TwoFactorCard({ onEnabled }: { onEnabled?: () => void }) {
  const qc = useQueryClient();
  const session = useSession()!;
  const { data: status } = useQuery({ queryKey: KEY, queryFn: () => api.get<TwoFactorStatus>('/auth/2fa') });
  const [setup, setSetup] = useState<{ secret: string; qrSvg: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [mode, setMode] = useState<'idle' | 'disable' | 'regen'>('idle');
  const [password, setPassword] = useState('');
  const refresh = (session = true) => {
    qc.invalidateQueries({ queryKey: KEY });
    if (session) refreshSession().catch(() => undefined);
  };
  const onError = (e: unknown) => toast.error(errorMessage(e));

  const start = useMutation({ mutationFn: () => api.post<{ secret: string; qrSvg: string }>('/auth/2fa/setup'), onSuccess: (s) => { setSetup(s); setCode(''); }, onError });
  const enable = useMutation({
    mutationFn: (c: string) => api.post<{ recoveryCodes: string[] }>('/auth/2fa/enable', { code: c }),
    onSuccess: (r) => {
      setSetup(null);
      setCode('');
      setCodes(r.recoveryCodes);
      // On the setup gate, refreshing the session would unmount it before the codes are seen; onEnabled does it after.
      refresh(!onEnabled);
    },
    onError: (e) => {
      setCode('');
      onError(e);
    },
  });
  const disable = useMutation({
    mutationFn: () => api.post('/auth/2fa/disable', { password, code }),
    onSuccess: () => {
      toast.success('Two-factor authentication is off');
      setMode('idle');
      setPassword('');
      setCode('');
      refresh();
    },
    onError,
  });
  const regen = useMutation({
    mutationFn: () => api.post<{ recoveryCodes: string[] }>('/auth/2fa/recovery-codes', { code }),
    onSuccess: (r) => {
      setCodes(r.recoveryCodes);
      setMode('idle');
      setCode('');
      refresh();
    },
    onError,
  });

  if (!status) return <section className="tile security-card"><Spinner /></section>;
  const on = status.enabled;

  return (
    <section className={`tile security-card${on ? ' on' : ''}`} aria-label="Two-factor authentication">
      <div className="email-hero security-hero">
        <span className="email-hero-icon">{on ? <ShieldCheck size={22} /> : <Smartphone size={22} />}</span>
        <div>
          <h2>Two-factor authentication</h2>
          <p className="muted small">
            {on
              ? `On since ${formatDate(status.enabledAt, { month: 'short', day: 'numeric', year: 'numeric' })} · ${status.recoveryCodesLeft} recovery codes left`
              : 'Protect your account with a code from an authenticator app (1Password, Google Authenticator, Authy…).'}
          </p>
        </div>
        <span className={`sec-pill ${on ? 'ok' : ''}`}>{on ? 'On' : 'Off'}</span>
      </div>

      {status.signedInWith === 'sso' && <p className="muted small">You signed in with single sign-on, so your identity provider's own MFA protects this session.</p>}
      {status.requiredByWorkspace && <p className="small sec-note">{session.organization.name} requires two-factor authentication for every member.</p>}

      {codes ? (
        <RecoveryCodes
          codes={codes}
          onDone={() => {
            setCodes(null);
            onEnabled?.();
          }}
        />
      ) : !on && !setup ? (
        <button className="btn btn-volt" onClick={() => start.mutate()} disabled={start.isPending}>
          <ShieldCheck size={15} /> Set up two-factor authentication
        </button>
      ) : !on && setup ? (
        <div className="tfa-setup">
          <div className="tfa-qr" aria-label="QR code for your authenticator app" dangerouslySetInnerHTML={{ __html: setup.qrSvg }} />
          <ol className="tfa-steps">
            <li>Open your authenticator app and scan the QR code.</li>
            <li>
              Can't scan? Enter this key:
              <span className="copy-line">
                <code className="tfa-secret">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
                <button className="icon-btn" aria-label="Copy key" onClick={() => navigator.clipboard?.writeText(setup.secret).then(() => toast.success('Key copied'))}>
                  <Copy size={13} />
                </button>
              </span>
            </li>
            <li>
              Enter the 6-digit code it shows:
              <form
                className="tfa-verify"
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  code.length === 6 && enable.mutate(code);
                }}
              >
                <CodeInput value={code} onChange={setCode} onComplete={(v) => enable.mutate(v)} autoFocus />
                <button className="btn btn-volt" disabled={enable.isPending || code.length !== 6}>
                  {enable.isPending ? <Spinner /> : 'Verify & turn on'}
                </button>
              </form>
            </li>
          </ol>
        </div>
      ) : mode === 'disable' ? (
        <form
          className="tfa-form"
          onSubmit={(e) => {
            e.preventDefault();
            disable.mutate();
          }}
        >
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </label>
          <label>
            Authenticator or recovery code
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456 or abcd-efgh" autoComplete="one-time-code" required />
          </label>
          <div className="row-actions">
            <button className="btn btn-danger" disabled={disable.isPending}>
              <ShieldOff size={14} /> Turn off
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setMode('idle')}>
              Cancel
            </button>
          </div>
        </form>
      ) : mode === 'regen' ? (
        <form
          className="tfa-form"
          onSubmit={(e) => {
            e.preventDefault();
            regen.mutate();
          }}
        >
          <label>
            Code from your authenticator app
            <CodeInput value={code} onChange={setCode} autoFocus />
          </label>
          <div className="row-actions">
            <button className="btn btn-volt" disabled={regen.isPending || code.length !== 6}>
              <KeyRound size={14} /> New recovery codes
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setMode('idle')}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="row-actions">
          <button className="btn btn-soft btn-sm" onClick={() => { setCode(''); setMode('regen'); }}>
            <KeyRound size={13} /> New recovery codes
          </button>
          {!status.requiredByWorkspace && (
            <button className="btn btn-ghost btn-sm" onClick={() => { setCode(''); setMode('disable'); }}>
              <ShieldOff size={13} /> Turn off
            </button>
          )}
        </div>
      )}
    </section>
  );
}
