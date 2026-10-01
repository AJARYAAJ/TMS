import { BellRing, Inbox, Mail, MailX } from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useUiStore } from '@/app/ui.store';
import { SkeletonRows } from '@/components/ui';
import { useSession } from '@/features/auth/session.store';
import { useEmailPrefs, useUpdateEmailPrefs } from './api';

/** Personal settings. Email notification preferences apply across every workspace you belong to. */
export default function SettingsPage() {
  const session = useSession()!;
  const { data, isLoading } = useEmailPrefs();
  const update = useUpdateEmailPrefs();
  const mark = useUiStore((s) => s.markOnboarding);
  useEffect(() => mark('email'), [mark]);
  const on = data?.enabled ?? true;
  const count = data ? data.options.filter((o) => data.categories[o.key]).length : 0;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <span className="eyebrow">{session.user.name}</span>
          <h1 className="display-sm">Settings</h1>
        </div>
      </header>

      <div className="settings-grid">
        <section className="tile email-prefs">
          <div className={`email-hero${on ? '' : ' off'}`}>
            <span className="email-hero-icon">{on ? <Mail size={22} /> : <MailX size={22} />}</span>
            <div>
              <h2>Email notifications</h2>
              <p className="muted small">
                {isLoading ? '…' : on ? (
                  <>
                    Sent to <strong>{data?.email}</strong> · {count} of {data?.options.length} kinds on
                  </>
                ) : (
                  'Paused. You will still see everything in your Inbox.'
                )}
              </p>
            </div>
            <label className="switch switch-lg ml-auto">
              <input type="checkbox" checked={on} disabled={!data} onChange={() => update.mutate({ enabled: !on })} aria-label="Email notifications" />
              <span />
            </label>
          </div>

          {isLoading || !data ? (
            <SkeletonRows rows={6} />
          ) : (
            <ul className={`pref-list${on ? '' : ' muted-list'}`} aria-disabled={!on}>
              {data.options.map((o) => (
                <li key={o.key}>
                  <div>
                    <strong>{o.label}</strong>
                    <span className="muted small">{o.description}</span>
                  </div>
                  <label className="switch ml-auto">
                    <input
                      type="checkbox"
                      checked={data.categories[o.key]}
                      disabled={!on}
                      onChange={() => update.mutate({ categories: { [o.key]: !data.categories[o.key] } })}
                      aria-label={o.label}
                    />
                    <span />
                  </label>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="tile settings-aside">
          <BellRing size={20} />
          <h3>How notifications reach you</h3>
          <p className="muted small">
            Everything lands in your <Link to="/inbox">Inbox</Link> instantly. Email is for the things you don't want to miss while away. Every email has a one-click unsubscribe
            link, and changes here apply to mail that is already queued.
          </p>
          <Link to="/inbox" className="btn btn-soft btn-sm">
            <Inbox size={13} /> Open Inbox
          </Link>
        </aside>
      </div>
    </div>
  );
}
