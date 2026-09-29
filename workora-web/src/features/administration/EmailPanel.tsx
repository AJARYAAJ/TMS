import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Mail, Send, ServerCog } from 'lucide-react';
import { EmptyState, SkeletonRows } from '@/components/ui';
import { toast } from '@/components/ui/toast';
import { api, errorMessage } from '@/services/api/client';
import { qk } from '@/services/api/keys';
import type { EmailStatus } from '@/types';
import { timeAgo } from '@/utils/format';

/** Admin → Email: SMTP transport status, a test send and this workspace's delivery log. */
export function EmailPanel() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: qk.emailStatus, queryFn: () => api.get<EmailStatus>('/email/status') });
  const test = useMutation({
    mutationFn: () => api.post<{ sent: boolean; to: string }>('/email/test'),
    onSuccess: (r) => toast.success(r.sent ? `Test email sent to ${r.to}` : 'SMTP not configured: test email was logged only'),
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.emailStatus }),
  });

  if (isLoading || !data) return <SkeletonRows rows={4} />;
  const smtp = data.transport === 'smtp';

  return (
    <div className="int-stack">
      <section className="tile int-card">
        <header className="int-head">
          <span className={`int-logo mail${smtp ? '' : ' off'}`}>
            <Mail size={22} />
          </span>
          <div>
            <h2>Email delivery</h2>
            <p className="muted small">
              Assignments, @mentions, overdue reminders and more are emailed to members based on their own preferences (Settings → Email notifications).
            </p>
          </div>
          <button className="btn btn-volt btn-sm ml-auto" onClick={() => test.mutate()} disabled={test.isPending}>
            <Send size={13} /> {test.isPending ? 'Sending…' : 'Send test email'}
          </button>
        </header>

        {smtp ? (
          <dl className="smtp-facts">
            <div>
              <dt>Server</dt>
              <dd className="mono">
                {data.host}:{data.port}
              </dd>
            </div>
            <div>
              <dt>Security</dt>
              <dd>
                <Lock size={12} /> {data.secure ? 'TLS (implicit)' : data.requireTls ? 'STARTTLS required' : 'STARTTLS when offered'}
              </dd>
            </div>
            <div>
              <dt>Auth</dt>
              <dd>{data.authenticated ? 'Username & password' : 'None'}</dd>
            </div>
            <div>
              <dt>From</dt>
              <dd className="ellipsis">{data.from}</dd>
            </div>
          </dl>
        ) : (
          <div className="banner banner-warn smtp-off">
            <ServerCog size={18} />
            <div>
              <strong>SMTP isn't configured, so emails are rendered and logged but not sent.</strong>
              <span className="small">
                Set <code>SMTP_URL=smtp://user:pass@smtp.example.com:587</code> (or <code>SMTP_HOST</code>, <code>SMTP_PORT</code>, <code>SMTP_USER</code>, <code>SMTP_PASS</code>) and{' '}
                <code>MAIL_FROM</code> on the API, then restart it.
              </span>
            </div>
          </div>
        )}

        <div className="mail-stats" aria-label="Last 7 days">
          <div>
            <strong>{data.last7Days.sent}</strong>
            <span className="muted small">sent · 7 days</span>
          </div>
          <div className={data.last7Days.failed ? 'bad' : ''}>
            <strong>{data.last7Days.failed}</strong>
            <span className="muted small">failed</span>
          </div>
          <div>
            <strong>{data.last7Days.skipped}</strong>
            <span className="muted small">skipped (opted out)</span>
          </div>
        </div>
      </section>

      <section className="tile">
        <div className="tile-head">
          <h2>Recent deliveries</h2>
          <span className="muted small">last 25</span>
        </div>
        {data.deliveries.length ? (
          <table className="data-table mail-log">
            <thead>
              <tr>
                <th>Status</th>
                <th>To</th>
                <th>Subject</th>
                <th>Kind</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {data.deliveries.map((d) => (
                <tr key={d.id} title={d.error ?? undefined}>
                  <td>
                    <span className={`mail-status ms-${d.status}`}>{d.status}</span>
                    {d.attempts > 1 && <span className="muted small"> ×{d.attempts}</span>}
                  </td>
                  <td className="ellipsis">{d.recipient}</td>
                  <td>
                    <span className="ellipsis block">{d.subject}</span>
                    {d.error && <span className="text-danger small ellipsis block">{d.error}</span>}
                  </td>
                  <td>
                    <span className="pill pill-soft">{d.category}</span>
                  </td>
                  <td className="muted small nowrap">{timeAgo(d.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState title="No emails yet">Assign a task to someone or send a test email.</EmptyState>
        )}
      </section>
    </div>
  );
}
