import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BellOff, BellRing, Monitor, Send } from 'lucide-react';
import { toast } from '@/components/ui/toast';
import { api, errorMessage } from '@/services/api/client';
import { formatDate } from '@/utils/format';
import { PUSH_KEY, usePushConfig } from './api';
import { disableDesktop, enableDesktop, showTestFromTab, useDesktop, type DesktopMode } from './desktop';

const STATUS: Record<DesktopMode, string> = {
  push: 'On in this browser. Notifications arrive even when Workora is closed.',
  tab: "On while Workora is open in a tab (this browser can't receive push messages).",
  off: 'Off in this browser.',
  blocked: "Blocked for this site. Allow notifications in your browser's site settings, then reload.",
  unsupported: "This browser doesn't support desktop notifications.",
};

/** Turn desktop notifications on or off for this browser, send a test, see which browsers get them. */
export function DesktopCard() {
  const { mode, busy } = useDesktop();
  const { data } = usePushConfig();
  const qc = useQueryClient();
  const on = mode === 'push' || mode === 'tab';
  const refresh = () => qc.invalidateQueries({ queryKey: PUSH_KEY });

  const test = useMutation({
    mutationFn: async () => (mode === 'push' ? api.post('/notifications/push/test') : showTestFromTab()),
    onSuccess: () => toast.success('Test notification sent'),
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <section className={`tile security-card desktop-card${on ? ' on' : ''}`} aria-label="Desktop notifications">
      <div className="email-hero security-hero">
        <span className="email-hero-icon">{on ? <BellRing size={22} /> : <Monitor size={22} />}</span>
        <div>
          <h2>Desktop notifications</h2>
          <p className="muted small">{STATUS[mode]}</p>
        </div>
        <span className={`sec-pill ${on ? 'ok' : ''}`}>{on ? 'On' : mode === 'blocked' ? 'Blocked' : 'Off'}</span>
      </div>
      <div className="row-actions">
        {on ? (
          <>
            <button className="btn btn-soft btn-sm" onClick={() => test.mutate()} disabled={test.isPending}>
              <Send size={13} /> Send a test
            </button>
            <button
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={async () => {
                await disableDesktop();
                refresh();
                toast.success('Desktop notifications are off in this browser');
              }}
            >
              <BellOff size={13} /> Turn off
            </button>
          </>
        ) : (
          mode !== 'unsupported' && (
            <button
              className="btn btn-volt"
              disabled={busy || mode === 'blocked'}
              onClick={async () => {
                const m = await enableDesktop();
                refresh();
                if (m === 'push' || m === 'tab') toast.success('Desktop notifications are on');
                else if (m === 'blocked') toast.error('Notifications are blocked for this site in your browser settings');
              }}
            >
              <BellRing size={15} /> Turn on desktop notifications
            </button>
          )
        )}
      </div>
      {!!data?.devices.length && (
        <div className="device-list">
          <span className="eyebrow">Browsers that get them</span>
          <ul>
            {data.devices.map((d) => (
              <li key={d.endpoint}>
                <Monitor size={13} />
                <span>{d.device || 'Browser'}</span>
                <span className="muted small ml-auto">added {formatDate(d.createdAt, { month: 'short', day: 'numeric' })}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
