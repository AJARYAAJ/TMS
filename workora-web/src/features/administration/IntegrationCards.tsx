import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Github, Send, Slack, Trash2 } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { SkeletonRows } from '@/components/ui';
import { toast } from '@/components/ui/toast';
import { useProjects } from '@/features/projects/api';
import { api, errorMessage } from '@/services/api/client';
import { qk } from '@/services/api/keys';
import type { Integration } from '@/types';
import { timeAgo } from '@/utils/format';

const SLACK_EVENTS: [string, string][] = [
  ['TASK_CREATED', 'Task created'],
  ['TASK_UPDATED', 'Task moved'],
  ['TASK_ASSIGNED', 'Assigned'],
  ['COMMENT_CREATED', 'Comments'],
  ['SPRINT_STARTED', 'Sprint started'],
  ['SPRINT_COMPLETED', 'Sprint completed'],
  ['TASK_OVERDUE', 'Overdue'],
  ['DEV_LINKED', 'Pull requests'],
  ['DOCUMENT_CREATED', 'New docs'],
];

const hookUrl = (path: string) => `${window.location.origin}${path}`;
const copy = (text: string, what = 'Copied') => navigator.clipboard?.writeText(text).then(() => toast.success(what));

function useIntegrations() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: qk.integrations, queryFn: () => api.get<Integration[]>('/integrations') });
  const refresh = () => qc.invalidateQueries({ queryKey: qk.integrations });
  const onError = (e: unknown) => toast.error(errorMessage(e));
  return {
    ...query,
    create: useMutation({ mutationFn: ({ provider, ...b }: { provider: 'slack' | 'github' } & Record<string, unknown>) => api.post<Integration>(`/integrations/${provider}`, b), onSuccess: refresh, onError }),
    update: useMutation({ mutationFn: ({ id, ...b }: { id: string } & Record<string, unknown>) => api.patch<Integration>(`/integrations/${id}`, b), onSuccess: refresh, onError }),
    remove: useMutation({ mutationFn: (id: string) => api.delete(`/integrations/${id}`), onSuccess: refresh, onError }),
    test: useMutation({
      mutationFn: (id: string) => api.post(`/integrations/${id}/test`),
      onSuccess: () => {
        toast.info('Test message sent to Slack');
        setTimeout(refresh, 1500);
      },
      onError,
    }),
  };
}

function Health({ i }: { i: Integration }) {
  const ok = i.lastStatus && i.lastStatus !== 'error';
  return (
    <span className="int-health" title={i.lastError ?? undefined}>
      <span className={`health ${i.lastStatus ? (ok ? 'ok' : 'bad') : ''}`} />
      {i.lastActivityAt ? `${i.lastStatus} ${timeAgo(i.lastActivityAt)}` : 'no activity yet'}
    </span>
  );
}

export function SlackCard() {
  const { data, isLoading, create, update, remove, test } = useIntegrations();
  const { data: projects } = useProjects();
  const slack = (data ?? []).filter((i) => i.provider === 'slack');
  const [form, setForm] = useState({ name: '', webhookUrl: '', projectId: '', commandProjectId: '', signingSecret: '', events: ['TASK_CREATED', 'TASK_UPDATED', 'COMMENT_CREATED', 'SPRINT_STARTED', 'SPRINT_COMPLETED', 'DEV_LINKED'] });
  const toggle = (ev: string) => setForm({ ...form, events: form.events.includes(ev) ? form.events.filter((e) => e !== ev) : [...form.events, ev] });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(
      {
        provider: 'slack',
        name: form.name,
        webhookUrl: form.webhookUrl || null,
        projectId: form.projectId || null,
        commandProjectId: form.commandProjectId || null,
        events: form.events,
        ...(form.signingSecret ? { signingSecret: form.signingSecret } : {}),
      },
      {
        onSuccess: () => {
          toast.success('Slack connected');
          setForm({ ...form, name: '', webhookUrl: '', signingSecret: '' });
        },
      },
    );
  };

  return (
    <section className="tile int-card">
      <header className="int-head">
        <span className="int-logo slack">
          <Slack size={22} />
        </span>
        <div>
          <h2>Slack</h2>
          <p className="muted small">Post updates to channels, and create or look up tasks with the <code>/workora</code> command.</p>
        </div>
      </header>

      {isLoading ? (
        <SkeletonRows rows={2} />
      ) : (
        slack.map((i) => (
          <div key={i.id} className="int-item">
            <div className="int-row">
              <strong>{i.name}</strong>
              <Health i={i} />
              <label className="switch ml-auto">
                <input type="checkbox" checked={i.enabled} onChange={() => update.mutate({ id: i.id, enabled: !i.enabled })} aria-label={`Enable ${i.name}`} />
                <span />
              </label>
              {i.config.hasWebhook && (
                <button className="btn btn-soft btn-sm" onClick={() => test.mutate(i.id)}>
                  <Send size={12} /> Test
                </button>
              )}
              <button className="icon-btn danger" aria-label={`Remove ${i.name}`} onClick={() => confirm(`Disconnect ${i.name}?`) && remove.mutate(i.id)}>
                <Trash2 size={14} />
              </button>
            </div>
            <div className="int-meta">
              {i.config.hasWebhook ? (
                <span className="chips">
                  {(i.config.events as string[]).map((ev) => (
                    <span key={ev} className="pill pill-soft">
                      {SLACK_EVENTS.find(([k]) => k === ev)?.[1] ?? ev}
                    </span>
                  ))}
                  <span className="muted small">in {i.config.projectId ? projects?.find((p) => p.id === i.config.projectId)?.name : 'all projects'}</span>
                </span>
              ) : (
                <span className="muted small">No channel notifications</span>
              )}
              {i.slashCommandEnabled && (
                <span className="copy-line">
                  Slash command URL <code>{hookUrl(i.hookPath)}</code>
                  <button className="icon-btn" aria-label="Copy slash command URL" onClick={() => copy(hookUrl(i.hookPath), 'Request URL copied')}>
                    <Copy size={13} />
                  </button>
                </span>
              )}
              {i.lastError && <span className="text-danger small">{i.lastError}</span>}
            </div>
          </div>
        ))
      )}

      <details className="int-connect" open={!slack.length}>
        <summary>{slack.length ? 'Connect another channel' : 'Connect Slack'}</summary>
        <ol className="int-steps muted small">
          <li>
            Create a Slack app → <b>Incoming Webhooks</b> → add one for your channel and paste its URL below.
          </li>
          <li>
            Optional: add a <b>Slash Command</b> <code>/workora</code>, paste the app's <b>Signing Secret</b> here, then use the Request URL shown after saving.
          </li>
        </ol>
        <form className="form int-form" onSubmit={submit}>
          <div className="form-row">
            <label>
              Name
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="#eng-updates" required />
            </label>
            <label>
              Incoming webhook URL
              <input value={form.webhookUrl} onChange={(e) => setForm({ ...form, webhookUrl: e.target.value })} placeholder="https://hooks.slack.com/services/…" type="url" />
            </label>
          </div>
          <div className="event-grid" role="group" aria-label="Events to post">
            {SLACK_EVENTS.map(([k, label]) => (
              <label key={k} className="check">
                <input type="checkbox" checked={form.events.includes(k)} onChange={() => toggle(k)} /> {label}
              </label>
            ))}
          </div>
          <div className="form-row">
            <label>
              Only for project
              <select value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>
                <option value="">All projects</option>
                {projects?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Signing secret (slash command)
              <input value={form.signingSecret} onChange={(e) => setForm({ ...form, signingSecret: e.target.value })} placeholder="optional" type="password" autoComplete="off" />
            </label>
            <label>
              <code>/workora create</code> adds to
              <select value={form.commandProjectId} onChange={(e) => setForm({ ...form, commandProjectId: e.target.value })}>
                <option value="">Ask for a project key</option>
                {projects?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button className="btn btn-volt" disabled={create.isPending || (!form.webhookUrl && !form.signingSecret)}>
            Connect Slack
          </button>
        </form>
      </details>
    </section>
  );
}

export function GithubCard() {
  const { data, isLoading, create, update, remove } = useIntegrations();
  const { data: projects } = useProjects();
  const github = (data ?? []).filter((i) => i.provider === 'github');
  const [created, setCreated] = useState<Integration | null>(null);
  const [form, setForm] = useState({ name: '', repository: '', projectId: '', createTasksFromIssues: false, onPrOpened: 'IN_REVIEW', onPrMerged: 'DONE', closeOnKeywords: true });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(
      {
        provider: 'github',
        name: form.name || form.repository || 'GitHub',
        repository: form.repository || null,
        projectId: form.projectId || null,
        createTasksFromIssues: form.createTasksFromIssues,
        onPrOpened: form.onPrOpened || null,
        onPrMerged: form.onPrMerged || null,
        closeOnKeywords: form.closeOnKeywords,
      },
      { onSuccess: (i) => setCreated(i) },
    );
  };

  return (
    <section className="tile int-card">
      <header className="int-head">
        <span className="int-logo github">
          <Github size={22} />
        </span>
        <div>
          <h2>GitHub</h2>
          <p className="muted small">
            Link branches, commits and pull requests that mention a task key (e.g. <code>ECOM-12</code>). PRs move tasks through your workflow; <code>fixes ECOM-12</code> closes them.
          </p>
        </div>
      </header>

      {created?.secret && (
        <div className="banner banner-volt int-secret">
          <div>
            <strong>Add this webhook in GitHub</strong> → repository <b>Settings → Webhooks → Add webhook</b>
            <div className="copy-line">
              Payload URL <code>{hookUrl(created.hookPath)}</code>
              <button className="icon-btn" aria-label="Copy payload URL" onClick={() => copy(hookUrl(created.hookPath), 'Payload URL copied')}>
                <Copy size={13} />
              </button>
            </div>
            <div className="copy-line">
              Secret <code>{created.secret}</code>
              <button className="icon-btn" aria-label="Copy secret" onClick={() => copy(created.secret!, 'Secret copied')}>
                <Copy size={13} />
              </button>
            </div>
            <span className="small">
              Content type <code>application/json</code> · events: <b>Pull requests, Pushes, Issues</b>. The secret is shown only once.
            </span>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => setCreated(null)}>
            Done
          </button>
        </div>
      )}

      {isLoading ? (
        <SkeletonRows rows={2} />
      ) : (
        github.map((i) => (
          <div key={i.id} className="int-item">
            <div className="int-row">
              <strong>{i.name}</strong>
              {i.config.repository !== i.name && <span className="pill pill-soft">{i.config.repository ?? 'any repository'}</span>}
              <Health i={i} />
              <label className="switch ml-auto">
                <input type="checkbox" checked={i.enabled} onChange={() => update.mutate({ id: i.id, enabled: !i.enabled })} aria-label={`Enable ${i.name}`} />
                <span />
              </label>
              <button className="icon-btn danger" aria-label={`Remove ${i.name}`} onClick={() => confirm(`Disconnect ${i.name}?`) && remove.mutate(i.id)}>
                <Trash2 size={14} />
              </button>
            </div>
            <div className="int-meta">
              <span className="muted small">
                PR opened → {i.config.onPrOpened ? i.config.onPrOpened.replace('_', ' ').toLowerCase() : 'no change'} · merged → {i.config.onPrMerged ? i.config.onPrMerged.toLowerCase() : 'no change'}
                {i.config.closeOnKeywords && ' · “fixes KEY” closes tasks'}
                {i.config.createTasksFromIssues && ` · issues → ${projects?.find((p) => p.id === i.config.projectId)?.name ?? 'project'}`}
              </span>
              <span className="copy-line">
                Payload URL <code>{hookUrl(i.hookPath)}</code>
                <button className="icon-btn" aria-label="Copy payload URL" onClick={() => copy(hookUrl(i.hookPath), 'Payload URL copied')}>
                  <Copy size={13} />
                </button>
              </span>
            </div>
          </div>
        ))
      )}

      <details className="int-connect" open={!github.length}>
        <summary>{github.length ? 'Connect another repository' : 'Connect a repository'}</summary>
        <form className="form int-form" onSubmit={submit}>
          <div className="form-row">
            <label>
              Repository
              <input value={form.repository} onChange={(e) => setForm({ ...form, repository: e.target.value })} placeholder="owner/name (blank = any repo)" pattern="[\w.\-]+\/[\w.\-]+" />
            </label>
            <label>
              Name
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="optional" />
            </label>
          </div>
          <div className="form-row">
            <label>
              When a PR opens, move task to
              <select value={form.onPrOpened} onChange={(e) => setForm({ ...form, onPrOpened: e.target.value })}>
                <option value="">Don't move</option>
                <option value="IN_PROGRESS">In progress</option>
                <option value="IN_REVIEW">In review</option>
              </select>
            </label>
            <label>
              When a PR merges, move task to
              <select value={form.onPrMerged} onChange={(e) => setForm({ ...form, onPrMerged: e.target.value })}>
                <option value="">Don't move</option>
                <option value="IN_REVIEW">In review</option>
                <option value="DONE">Done</option>
              </select>
            </label>
          </div>
          <label className="check">
            <input type="checkbox" checked={form.closeOnKeywords} onChange={(e) => setForm({ ...form, closeOnKeywords: e.target.checked })} /> Close tasks from <code>fixes KEY</code> commits on the default branch and closed issues
          </label>
          <div className="form-row">
            <label className="check">
              <input type="checkbox" checked={form.createTasksFromIssues} onChange={(e) => setForm({ ...form, createTasksFromIssues: e.target.checked })} /> Create tasks from new GitHub issues
            </label>
            <label>
              in project
              <select value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })} required={form.createTasksFromIssues}>
                <option value="">—</option>
                {projects?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button className="btn btn-volt" disabled={create.isPending}>
            Connect GitHub
          </button>
        </form>
      </details>
    </section>
  );
}
