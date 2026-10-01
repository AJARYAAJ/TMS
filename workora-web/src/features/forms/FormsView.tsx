import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Copy, ExternalLink, Inbox, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { EmptyState, SkeletonRows } from '@/components/ui';
import { toast } from '@/components/ui/toast';
import { useCan } from '@/features/auth/session.store';
import { useFields } from '@/features/fields/api';
import { FIELD_ICON } from '@/features/fields/FieldValues';
import { useUsers } from '@/features/projects/api';
import { useProjectContext } from '@/features/projects/ProjectLayout';
import { api, errorMessage } from '@/services/api/client';
import { qk } from '@/services/api/keys';
import { FormQuestion, IntakeForm, QuestionKind, TASK_PRIORITIES, TASK_TYPES } from '@/types';
import { PRIORITY_LABEL, timeAgo, TYPE_LABEL } from '@/utils/format';
import { FormBody } from './PublicFormPage';

const BUILTIN: { kind: QuestionKind; label: string; hint: string }[] = [
  { kind: 'description', label: 'Details', hint: 'Long answer → task description' },
  { kind: 'name', label: 'Your name', hint: 'Who is asking' },
  { kind: 'email', label: 'Your email', hint: 'For follow-up' },
  { kind: 'priority', label: 'How urgent is this?', hint: 'Sets priority' },
  { kind: 'type', label: 'What kind of request?', hint: 'Bug, story, task…' },
  { kind: 'dueDate', label: 'When do you need it?', hint: 'Sets due date' },
];

const KIND_LABEL: Record<QuestionKind, string> = { title: 'Task title', description: 'Details', name: 'Name', email: 'Email', priority: 'Priority', type: 'Type', dueDate: 'Due date', field: 'Field' };

const publicUrl = (f: IntakeForm) => `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}${f.publicPath}`;

export default function FormsView() {
  const project = useProjectContext();
  const qc = useQueryClient();
  const canEdit = useCan('MEMBER');
  const { data: forms, isLoading } = useQuery({ queryKey: qk.forms(project.id), queryFn: () => api.get<IntakeForm[]>(`/projects/${project.id}/forms`) });
  const [editing, setEditing] = useState<IntakeForm | 'new' | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: qk.forms(project.id) });
  const toggle = useMutation({ mutationFn: (f: IntakeForm) => api.patch(`/forms/${f.id}`, { enabled: !f.enabled }), onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) });
  const remove = useMutation({ mutationFn: (f: IntakeForm) => api.delete(`/forms/${f.id}`), onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) });

  if (editing) return <FormBuilder projectId={project.id} projectName={project.name} form={editing === 'new' ? null : editing} onDone={() => { setEditing(null); refresh(); }} />;

  return (
    <div className="page forms-page">
      <div className="fields-intro">
        <div>
          <h2>Intake forms</h2>
          <p className="muted">Share a link with customers or other teams. Every submission becomes a task in {project.name} — no account needed.</p>
        </div>
        {canEdit && (
          <button className="btn btn-volt" onClick={() => setEditing('new')}>
            <Plus size={14} /> New form
          </button>
        )}
      </div>
      {isLoading ? (
        <SkeletonRows rows={3} />
      ) : forms?.length ? (
        <div className="form-cards">
          {forms.map((f) => (
            <article key={f.id} className={`tile form-card${f.enabled ? '' : ' off'}`}>
              <header>
                <span className="form-icon">
                  <Inbox size={18} />
                </span>
                <div>
                  <h3>{f.name}</h3>
                  <span className="muted small">
                    {f.submissionCount} {f.submissionCount === 1 ? 'response' : 'responses'}
                    {f.lastSubmittedAt ? ` · last ${timeAgo(f.lastSubmittedAt)}` : ''} · {f.questions.length} questions
                  </span>
                </div>
                {canEdit && (
                  <label className="switch ml-auto" title={f.enabled ? 'Accepting responses' : 'Closed'}>
                    <input type="checkbox" checked={f.enabled} onChange={() => toggle.mutate(f)} aria-label={`Accept responses for ${f.name}`} />
                    <span />
                  </label>
                )}
              </header>
              <div className="copy-line">
                <code>{publicUrl(f)}</code>
                <button className="icon-btn" aria-label="Copy form link" onClick={() => navigator.clipboard?.writeText(publicUrl(f)).then(() => toast.success('Form link copied'))}>
                  <Copy size={13} />
                </button>
                <a className="icon-btn" href={publicUrl(f)} target="_blank" rel="noopener noreferrer" aria-label="Open form">
                  <ExternalLink size={13} />
                </a>
              </div>
              {canEdit && (
                <footer>
                  <button className="btn btn-soft btn-sm" onClick={() => setEditing(f)}>
                    Edit questions
                  </button>
                  <button className="icon-btn danger ml-auto" aria-label={`Delete ${f.name}`} onClick={() => confirm(`Delete form “${f.name}”? Its link stops working.`) && remove.mutate(f)}>
                    <Trash2 size={14} />
                  </button>
                </footer>
              )}
            </article>
          ))}
        </div>
      ) : (
        <EmptyState title="No forms yet" action={canEdit ? <button className="btn btn-volt" onClick={() => setEditing('new')}>Create a form</button> : undefined}>
          Collect bug reports, feature requests or IT tickets straight into this project.
        </EmptyState>
      )}
    </div>
  );
}

function FormBuilder({ projectId, projectName, form, onDone }: { projectId: string; projectName: string; form: IntakeForm | null; onDone: () => void }) {
  const { data: fields } = useFields(projectId);
  const { data: users } = useUsers();
  const [name, setName] = useState(form?.name ?? 'Request form');
  const [description, setDescription] = useState(form?.description ?? '');
  const [questions, setQuestions] = useState<FormQuestion[]>(
    form?.questions ?? [
      { id: 'title', kind: 'title', label: 'What do you need?', required: true },
      { id: 'description', kind: 'description', label: 'Details', help: 'Steps, links, anything that helps.', required: false },
      { id: 'email', kind: 'email', label: 'Your email', required: false },
    ],
  );
  const [defaults, setDefaults] = useState(form?.defaults ?? {});
  const save = useMutation({
    mutationFn: () => {
      const body = { name, description, questions: questions.map(({ id, kind, fieldId, label, help, required }) => ({ id, kind, fieldId, label, help, required })), defaults };
      return form ? api.patch(`/forms/${form.id}`, body) : api.post(`/projects/${projectId}/forms`, body);
    },
    onSuccess: () => {
      toast.success(form ? 'Form saved' : 'Form created — copy its link to share');
      onDone();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const has = (k: QuestionKind, fieldId?: string) => questions.some((q) => q.kind === k && (!fieldId || q.fieldId === fieldId));
  const add = (q: Omit<FormQuestion, 'id'>) => setQuestions([...questions, { ...q, id: q.kind === 'field' ? `f_${q.fieldId!.slice(0, 8)}` : q.kind }]);
  const patch = (i: number, p: Partial<FormQuestion>) => setQuestions(questions.map((q, j) => (j === i ? { ...q, ...p } : q)));
  const move = (i: number, d: number) => {
    const next = [...questions];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setQuestions(next);
  };

  return (
    <div className="page form-builder">
      <div className="fb-editor">
        <div className="fb-head">
          <button className="btn btn-ghost btn-sm" onClick={onDone}>
            ← All forms
          </button>
          <button className="btn btn-volt ml-auto" onClick={() => save.mutate()} disabled={save.isPending || !name.trim()}>
            {form ? 'Save form' : 'Create form'}
          </button>
        </div>
        <section className="tile">
          <label>
            Form title
            <input className="fb-title" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} aria-label="Form title" />
          </label>
          <label>
            Intro text
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={2000} placeholder="Tell people what this form is for." />
          </label>
        </section>
        <section className="tile">
          <h3>Questions</h3>
          <ol className="fb-questions">
            {questions.map((q, i) => {
              const field = q.kind === 'field' ? fields?.find((f) => f.id === q.fieldId) : null;
              const Icon = field ? FIELD_ICON[field.type] : null;
              return (
                <li key={q.id} className="fb-q">
                  <span className="fb-kind">{field ? <>{Icon && <Icon size={12} />} {field.name}</> : KIND_LABEL[q.kind]}</span>
                  <input value={q.label} onChange={(e) => patch(i, { label: e.target.value })} aria-label="Question" maxLength={200} />
                  <input className="fb-help" value={q.help ?? ''} onChange={(e) => patch(i, { help: e.target.value })} placeholder="Help text (optional)" aria-label="Help text" maxLength={500} />
                  <label className="check">
                    <input type="checkbox" checked={q.required} disabled={q.kind === 'title'} onChange={(e) => patch(i, { required: e.target.checked })} /> Required
                  </label>
                  <span className="fb-tools">
                    <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                      <ArrowUp size={13} />
                    </button>
                    <button className="icon-btn" disabled={i === questions.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                      <ArrowDown size={13} />
                    </button>
                    {q.kind !== 'title' && (
                      <button className="icon-btn" onClick={() => setQuestions(questions.filter((_, j) => j !== i))} aria-label={`Remove ${q.label}`}>
                        <X size={13} />
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
          <div className="fb-add">
            <span className="muted small">Add:</span>
            {BUILTIN.filter((b) => !has(b.kind)).map((b) => (
              <button key={b.kind} className="chip-btn" title={b.hint} onClick={() => add({ kind: b.kind, label: b.label, required: false })}>
                <Plus size={11} /> {b.label}
              </button>
            ))}
            {fields
              ?.filter((f) => f.type !== 'PERSON' && !has('field', f.id))
              .map((f) => {
                const Icon = FIELD_ICON[f.type];
                return (
                  <button key={f.id} className="chip-btn field" onClick={() => add({ kind: 'field', fieldId: f.id, label: f.name, required: f.required })}>
                    <Icon size={11} /> {f.name}
                  </button>
                );
              })}
          </div>
        </section>
        <section className="tile">
          <h3>New tasks get</h3>
          <div className="form-row">
            <label>
              Type
              <select value={defaults.type ?? ''} onChange={(e) => setDefaults({ ...defaults, type: (e.target.value || undefined) as never })}>
                <option value="">Task</option>
                {TASK_TYPES.filter((t) => t !== 'EPIC').map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Priority
              <select value={defaults.priority ?? ''} onChange={(e) => setDefaults({ ...defaults, priority: (e.target.value || undefined) as never })}>
                <option value="">Medium</option>
                {TASK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Assign to
              <select value={defaults.assigneeId ?? ''} onChange={(e) => setDefaults({ ...defaults, assigneeId: e.target.value || undefined })}>
                <option value="">Nobody (triage)</option>
                {users?.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>
      </div>
      <aside className="fb-preview" aria-label="Live preview">
        <span className="eyebrow">Live preview</span>
        <div className="public-form preview">
          <FormBody
            form={{
              name,
              description,
              organization: '',
              project: { name: projectName, color: 'var(--accent)' },
              questions: questions
                .map((q) => {
                  const f = q.kind === 'field' ? fields?.find((x) => x.id === q.fieldId) : null;
                  return { ...q, help: q.help ?? '', field: f ? { type: f.type, options: f.options } : null };
                })
                .filter((q) => q.kind !== 'field' || q.field),
            }}
            preview
          />
        </div>
      </aside>
    </div>
  );
}
