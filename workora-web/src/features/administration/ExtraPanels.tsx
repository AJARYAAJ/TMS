import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, GitMerge, Send, Tag, Trash2, Webhook as WebhookIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Picker } from '@/components/ui/Picker';
import { useCan } from '@/features/auth/session.store';
import { FormEvent, useState } from 'react';
import { EmptyState, LabelChip, SkeletonRows } from '@/components/ui';
import { toast } from '@/components/ui/toast';
import { useCreateLabel, useDeleteLabel, useLabels, useMergeLabel, useUpdateLabel } from '@/features/tasks/api';
import { api, errorMessage } from '@/services/api/client';
import { qk } from '@/services/api/keys';
import type { Label, Webhook } from '@/types';
import { timeAgo } from '@/utils/format';

const COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#84cc16', '#64748b'];

export function LabelsPanel() {
  const { data, isLoading } = useLabels();
  const create = useCreateLabel();
  const canDelete = useCan('ADMIN');
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [description, setDescription] = useState('');
  const [q, setQ] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) create.mutate({ name: name.trim(), color, description: description.trim() || undefined }, { onSuccess: () => { setName(''); setDescription(''); } });
  };
  const shown = (data ?? []).filter((l) => !q || `${l.name} ${l.description ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  const unused = (data ?? []).filter((l) => !l.usage).length;
  return (
    <section className="tile labels-panel">
      <div className="tile-head">
        <h2>Labels</h2>
        <span className="muted small">
          {data?.length ?? 0} labels{unused ? ` · ${unused} unused` : ''}
        </span>
      </div>
      <p className="muted small">Shared by every project. Filter lists and boards by label, use them in automations, and merge duplicates here.</p>
      <form className="label-new" onSubmit={submit}>
        <span className="label-preview" style={{ ['--lc' as any]: color }}>
          <LabelChip label={{ name: name.trim() || 'new label', color }} />
        </span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Label name" aria-label="Label name" maxLength={40} />
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is it for? (optional)" aria-label="Label description" maxLength={200} />
        <div className="swatches" role="radiogroup" aria-label="Label color">
          {COLORS.map((c) => (
            <button type="button" key={c} role="radio" aria-checked={c === color} aria-label={c} className={c === color ? 'on' : ''} style={{ background: c }} onClick={() => setColor(c)} />
          ))}
        </div>
        <button className="btn btn-volt btn-sm" disabled={create.isPending || !name.trim()}>
          Add label
        </button>
      </form>
      {(data?.length ?? 0) > 6 && <input className="filter-input label-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a label…" aria-label="Find a label" />}
      {isLoading ? (
        <SkeletonRows rows={3} />
      ) : !data?.length ? (
        <EmptyState icon={<Tag size={26} />} title="No labels yet">Create one above, or right from a task's label picker.</EmptyState>
      ) : (
        <ul className="label-admin">
          {shown.map((l) => (
            <LabelRow key={l.id} label={l} all={data} canDelete={canDelete} />
          ))}
        </ul>
      )}
    </section>
  );
}

function LabelRow({ label, all, canDelete }: { label: Label; all: Label[]; canDelete: boolean }) {
  const update = useUpdateLabel();
  const merge = useMergeLabel();
  const remove = useDeleteLabel();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(label.name);
  const [description, setDescription] = useState(label.description ?? '');
  const [merging, setMerging] = useState(false);
  const save = () => {
    const patch: { id: string; name?: string; description?: string } = { id: label.id };
    if (name.trim() && name.trim() !== label.name) patch.name = name.trim();
    if (description.trim() !== (label.description ?? '')) patch.description = description.trim();
    if (patch.name || patch.description !== undefined) update.mutate(patch, { onSuccess: () => setEditing(false) });
    else setEditing(false);
  };
  return (
    <li className={editing ? 'editing' : ''}>
      <Picker
        label={`Colour of ${label.name}`}
        value={label.color}
        options={COLORS.map((c) => ({ value: c, label: c, icon: <span className="cf-dot" style={{ background: c }} /> }))}
        onChange={(c) => c && update.mutate({ id: label.id, color: c })}
      >
        <span className="label-dot" style={{ background: label.color }} />
      </Picker>
      {editing ? (
        <form
          className="label-edit"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={40} aria-label="Label name" />
          <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} placeholder="Description" aria-label="Label description" />
          <button className="btn btn-volt btn-sm">Save</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <button className="label-main" onClick={() => setEditing(true)} title="Rename or describe">
          <LabelChip label={label} />
          <span className="muted small ellipsis">{label.description || 'Add a description…'}</span>
        </button>
      )}
      <Link to={`/labels/${label.id}`} className="label-usage" title="See every task with this label">
        {label.openUsage ?? 0} open / {label.usage ?? 0}
      </Link>
      {canDelete && (
        <span className="row-tools">
          {merging ? (
            <select
              autoFocus
              value=""
              aria-label={`Merge ${label.name} into`}
              onBlur={() => setMerging(false)}
              onChange={(e) => {
                const into = all.find((x) => x.id === e.target.value);
                if (into && confirm(`Merge “${label.name}” into “${into.name}”? Tasks keep “${into.name}” and “${label.name}” is deleted.`)) merge.mutate({ id: label.id, into: into.id });
                setMerging(false);
              }}
            >
              <option value="">Merge into…</option>
              {all
                .filter((x) => x.id !== label.id)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
            </select>
          ) : (
            <button className="icon-btn" title="Merge into another label" aria-label={`Merge ${label.name}`} onClick={() => setMerging(true)}>
              <GitMerge size={14} />
            </button>
          )}
          <button className="icon-btn danger" aria-label={`Delete ${label.name}`} onClick={() => confirm(`Delete label “${label.name}”? It will be removed from all tasks.`) && remove.mutate(label.id)}>
            <Trash2 size={14} />
          </button>
        </span>
      )}
    </li>
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
