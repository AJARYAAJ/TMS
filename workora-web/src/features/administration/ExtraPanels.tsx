import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Send, Tag, Trash2, Webhook as WebhookIcon } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { EmptyState, LabelChip, SkeletonRows } from '@/components/ui';
import { toast } from '@/components/ui/toast';
import { useCreateLabel, useDeleteLabel, useLabels } from '@/features/tasks/api';
import { api, errorMessage } from '@/services/api/client';
import { qk } from '@/services/api/keys';
import type { Webhook } from '@/types';
import { timeAgo } from '@/utils/format';

const COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#84cc16', '#64748b'];

export function LabelsPanel() {
  const { data, isLoading } = useLabels();
  const create = useCreateLabel();
  const remove = useDeleteLabel();
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) create.mutate({ name: name.trim(), color }, { onSuccess: () => setName('') });
  };
  return (
    <section className="tile">
      <h2>Labels</h2>
      <p className="muted small">Labels are shared by every project in the workspace. Use them to filter lists and in automation conditions.</p>
      <form className="inline-form" onSubmit={submit}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New label" aria-label="Label name" maxLength={40} />
        <div className="swatches" role="radiogroup" aria-label="Label color">
          {COLORS.map((c) => (
            <button type="button" key={c} role="radio" aria-checked={c === color} className={c === color ? 'on' : ''} style={{ background: c }} onClick={() => setColor(c)} />
          ))}
        </div>
        <button className="btn btn-volt btn-sm" disabled={create.isPending}>
          Add label
        </button>
      </form>
      {isLoading ? (
        <SkeletonRows rows={3} />
      ) : !data?.length ? (
        <EmptyState icon={<Tag size={26} />} title="No labels yet" />
      ) : (
        <ul className="label-admin">
          {data.map((l) => (
            <li key={l.id}>
              <LabelChip label={l} />
              <span className="muted small">{l.usage ?? 0} tasks</span>
              <button className="icon-btn danger ml-auto" aria-label={`Delete ${l.name}`} onClick={() => confirm(`Delete label “${l.name}”? It will be removed from all tasks.`) && remove.mutate(l.id)}>
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const EVENTS = ['*', 'TASK_CREATED', 'TASK_UPDATED', 'TASK_ASSIGNED', 'TASK_DELETED', 'COMMENT_CREATED', 'SPRINT_STARTED', 'SPRINT_COMPLETED', 'DOCUMENT_UPDATED', 'GOAL_UPDATED', 'TASK_OVERDUE'];

export function IntegrationsPanel() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: qk.webhooks, queryFn: () => api.get<Webhook[]>('/integrations/webhooks') });
  const refresh = () => qc.invalidateQueries({ queryKey: qk.webhooks });
  const [form, setForm] = useState({ name: '', url: '', events: ['*'] });
  const [secret, setSecret] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => api.post<Webhook>('/integrations/webhooks', form),
    onSuccess: (w) => {
      setSecret(w.secret ?? null);
      setForm({ name: '', url: '', events: ['*'] });
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const toggle = useMutation({ mutationFn: (w: Webhook) => api.patch(`/integrations/webhooks/${w.id}`, { enabled: !w.enabled }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/integrations/webhooks/${id}`), onSuccess: refresh });
  const test = useMutation({
    mutationFn: (id: string) => api.post(`/integrations/webhooks/${id}/test`),
    onSuccess: (_d, id) => {
      toast.info('Test ping queued');
      setTimeout(() => {
        refresh();
        qc.invalidateQueries({ queryKey: ['deliveries', id] });
      }, 1500);
    },
  });

  return (
    <section className="tile">
      <h2>Webhooks</h2>
      <p className="muted small">
        Stream Workora events to Slack bridges, CI, data warehouses or your own services. Each delivery is signed with <code>X-Workora-Signature: sha256=HMAC(secret, body)</code> and retried with backoff.
      </p>
      <form
        className="webhook-form"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name (e.g. Deploy bot)" required aria-label="Webhook name" />
        <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://example.com/hooks/workora" required type="url" aria-label="Webhook URL" />
        <select value={form.events[0]} onChange={(e) => setForm({ ...form, events: [e.target.value] })} aria-label="Events">
          {EVENTS.map((ev) => (
            <option key={ev} value={ev}>
              {ev === '*' ? 'All events' : ev}
            </option>
          ))}
        </select>
        <button className="btn btn-volt btn-sm" disabled={create.isPending}>
          Add webhook
        </button>
      </form>
      {secret && (
        <div className="banner banner-volt">
          Signing secret (shown once): <code>{secret}</code>
          <button className="btn btn-soft btn-sm" onClick={() => navigator.clipboard?.writeText(secret).then(() => toast.success('Copied'))}>
            <Copy size={13} /> Copy
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setSecret(null)}>
            Done
          </button>
        </div>
      )}
      {isLoading ? (
        <SkeletonRows rows={2} />
      ) : !data?.length ? (
        <EmptyState icon={<WebhookIcon size={26} />} title="No webhooks yet" />
      ) : (
        <ul className="webhooks">
          {data.map((w) => (
            <li key={w.id}>
              <div className="webhook-row">
                <span className={`health ${w.lastDelivery ? (w.lastDelivery.success ? 'ok' : 'bad') : ''}`} title={w.lastDelivery ? `Last delivery ${w.lastDelivery.success ? 'succeeded' : 'failed'} ${timeAgo(w.lastDelivery.at)}` : 'No deliveries yet'} />
                <strong>{w.name}</strong>
                <code className="ellipsis">{w.url}</code>
                <span className="pill pill-soft">{w.events.includes('*') ? 'all events' : w.events.join(', ')}</span>
                <label className="switch ml-auto">
                  <input type="checkbox" checked={w.enabled} onChange={() => toggle.mutate(w)} aria-label={`Enable ${w.name}`} />
                  <span />
                </label>
                <button className="btn btn-soft btn-sm" onClick={() => test.mutate(w.id)}>
                  <Send size={13} /> Test
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setOpen(open === w.id ? null : w.id)}>
                  Log
                </button>
                <button className="icon-btn danger" aria-label={`Delete ${w.name}`} onClick={() => confirm(`Delete webhook “${w.name}”?`) && remove.mutate(w.id)}>
                  <Trash2 size={14} />
                </button>
              </div>
              {open === w.id && <Deliveries id={w.id} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Deliveries({ id }: { id: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['deliveries', id],
    queryFn: () => api.get<{ id: string; eventType: string; statusCode: number | null; success: boolean; durationMs: number; error: string | null; attempt: number; createdAt: string }[]>(`/integrations/webhooks/${id}/deliveries`),
    refetchInterval: 5000,
  });
  if (isLoading) return <SkeletonRows rows={2} />;
  if (!data?.length) return <p className="muted small">No deliveries yet.</p>;
  return (
    <table className="data-table deliveries">
      <tbody>
        {data.map((d) => (
          <tr key={d.id}>
            <td>
              <span className={`health ${d.success ? 'ok' : 'bad'}`} />
            </td>
            <td className="mono small">{d.eventType}</td>
            <td>{d.statusCode ?? '—'}</td>
            <td className="muted small">{d.error ?? `${d.durationMs} ms`}</td>
            <td className="muted small">attempt {d.attempt}</td>
            <td className="muted small">{timeAgo(d.createdAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
