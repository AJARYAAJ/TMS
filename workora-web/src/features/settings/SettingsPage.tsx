import { Bell, BellRing, Inbox, Mail, Monitor } from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useUiStore } from '@/app/ui.store';
import { SkeletonRows } from '@/components/ui';
import { useSession } from '@/features/auth/session.store';
import { usePushConfig, useUpdatePushPrefs } from '@/features/notifications/api';
import { DesktopCard } from '@/features/notifications/DesktopCard';
import { useDesktop } from '@/features/notifications/desktop';
import { useEmailPrefs, useUpdateEmailPrefs } from './api';
import { TwoFactorCard } from './Security';

/**
 * Personal settings. Notification preferences apply across every workspace you belong to:
 * everything always reaches the bell and Inbox; each kind can also go to desktop and email.
 */
export default function SettingsPage() {
  const session = useSession()!;
  const { data: email, isLoading } = useEmailPrefs();
  const updateEmail = useUpdateEmailPrefs();
  const { data: push } = usePushConfig();
  const updatePush = useUpdatePushPrefs();
  const desktopMode = useDesktop((s) => s.mode);
  const mark = useUiStore((s) => s.markOnboarding);
  useEffect(() => mark('email'), [mark]);
  const emailOn = email?.enabled ?? true;
  const pushOn = push?.enabled ?? true;
  const desktopHere = desktopMode === 'push' || desktopMode === 'tab';

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <span className="eyebrow">{session.user.name}</span>
          <h1 className="display-sm">Settings</h1>
        </div>
      </header>

      <div className="settings-grid">
        <section className="tile email-prefs" aria-label="Notification preferences">
          <div className="email-hero">
            <span className="email-hero-icon">
              <Bell size={22} />
            </span>
            <div>
              <h2>Notifications</h2>
              <p className="muted small">
                Everything always shows in your bell and <Link to="/inbox">Inbox</Link>. Choose what also reaches your desktop and your email
                {email && (
                  <>
                    {' '}
                    (<strong>{email.email}</strong>)
                  </>
                )}
                .
              </p>
            </div>
          </div>

          {isLoading || !email || !push ? (
            <SkeletonRows rows={8} />
          ) : (
            <>
              <div className="pref-head">
                <span />
                <label className="pref-col">
                  <Monitor size={14} /> Desktop
                  <span className="switch switch-sm">
                    <input type="checkbox" checked={pushOn} onChange={() => updatePush.mutate({ enabled: !pushOn })} aria-label="Desktop notifications" />
                    <span />
                  </span>
                </label>
                <label className="pref-col">
                  <Mail size={14} /> Email
                  <span className="switch switch-sm">
                    <input type="checkbox" checked={emailOn} onChange={() => updateEmail.mutate({ enabled: !emailOn })} aria-label="Email notifications" />
                    <span />
                  </span>
                </label>
              </div>
              {!desktopHere && desktopMode !== 'unsupported' && (
                <p className="pref-hint small">
                  <BellRing size={13} /> Desktop notifications are off in this browser. Turn them on with the Desktop notifications card.
                </p>
              )}
              <ul className="pref-list pref-matrix">
                {email.options.map((o) => (
                  <li key={o.key}>
                    <div>
                      <strong>{o.label}</strong>
                      <span className="muted small">{o.description}</span>
                    </div>
                    <label className={`switch desktop${pushOn ? '' : ' muted-switch'}`}>
                      <input
                        type="checkbox"
                        checked={push.categories[o.key] ?? true}
                        disabled={!pushOn}
                        onChange={() => updatePush.mutate({ categories: { [o.key]: !(push.categories[o.key] ?? true) } })}
                        aria-label={`Desktop: ${o.label}`}
                      />
                      <span />
                    </label>
                    <label className={`switch email${emailOn ? '' : ' muted-switch'}`}>
                      <input
                        type="checkbox"
                        checked={email.categories[o.key]}
                        disabled={!emailOn}
                        onChange={() => updateEmail.mutate({ categories: { [o.key]: !email.categories[o.key] } })}
                        aria-label={o.label}
                      />
                      <span />
                    </label>
                  </li>
                ))}
              </ul>
              <p className="muted small pref-foot">Security alerts (two-factor changes, a recovery code being used) always reach you.</p>
            </>
          )}
        </section>

        <div className="settings-side">
          <DesktopCard />
          <TwoFactorCard />
          <aside className="tile settings-aside">
            <BellRing size={20} />
            <h3>How notifications reach you</h3>
            <p className="muted small">
              The bell updates live while you work. Desktop notifications reach you in other tabs and apps, and email is for when you are away. Every email has a one-click
              unsubscribe link, and changes here apply to anything already queued.
            </p>
            <Link to="/inbox" className="btn btn-soft btn-sm">
              <Inbox size={13} /> Open Inbox
            </Link>
          </aside>
        </div>
      </div>
    </div>
  );
}
