import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, Send } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Spinner } from '@/components/ui';
import { api, errorMessage } from '@/services/api/client';
import type { FieldType, FormQuestion } from '@/types';
import { PRIORITY_LABEL, TYPE_LABEL } from '@/utils/format';

export interface PublicForm {
  name: string;
  description: string;
  organization: string;
  project: { name: string; color: string };
  questions: (Pick<FormQuestion, 'id' | 'kind' | 'label' | 'required'> & { help: string; field: { type: FieldType; options: { id: string; label: string; color: string }[] } | null })[];
}

/** Public form at /f/:slug — no account needed. Submissions become tasks. */
export default function PublicFormPage() {
  const { slug } = useParams();
  const { data, error, isLoading } = useQuery({ queryKey: ['public-form', slug], queryFn: () => api.get<PublicForm>(`/public/forms/${slug}`), retry: false });
  return (
    <div className="public-form-page">
      <div className="public-form">
        {isLoading ? (
          <p className="muted">
            <Spinner /> Loading form…
          </p>
        ) : error || !data ? (
          <div className="pf-closed">
            <h1>This form isn't available</h1>
            <p className="muted">{errorMessage(error)}</p>
          </div>
        ) : (
          <FormBody form={data} slug={slug} />
        )}
      </div>
      <p className="pf-brand muted small">
        Powered by <strong>Workora</strong>
      </p>
    </div>
  );
}

type Answers = Record<string, string | boolean | string[]>;

export function FormBody({ form, slug, preview }: { form: PublicForm; slug?: string; preview?: boolean }) {
  const [answers, setAnswers] = useState<Answers>({});
  const [website, setWebsite] = useState('');
  const [missing, setMissing] = useState<string[]>([]);
  const submit = useMutation({
    mutationFn: () => api.post<{ ok: boolean; key?: string }>(`/public/forms/${slug}`, { answers, website }),
    onError: (e: any) => setMissing(e?.details?.missing ?? []),
  });
  const set = (id: string, v: Answers[string]) => {
    setAnswers({ ...answers, [id]: v });
    setMissing(missing.filter((m) => m !== id));
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (preview) return;
    const empty = form.questions.filter((q) => q.required && (answers[q.id] === undefined || answers[q.id] === '' || (Array.isArray(answers[q.id]) && !(answers[q.id] as string[]).length))).map((q) => q.id);
    if (empty.length) return setMissing(empty);
    submit.mutate();
  };

  if (submit.isSuccess)
    return (
      <div className="pf-done">
        <CheckCircle2 size={40} />
        <h1>Thanks — we've got it.</h1>
        <p className="muted">
          Your request was added to <strong>{form.project.name}</strong>
          {submit.data?.key ? ` as ${submit.data.key}` : ''}.
        </p>
        <button className="btn btn-soft" onClick={() => { submit.reset(); setAnswers({}); }}>
          Submit another response
        </button>
      </div>
    );

  return (
    <form className="pf-form" onSubmit={onSubmit} noValidate>
      <header className="pf-head" style={{ ['--app' as any]: form.project.color }}>
        <span className="pf-mark">{form.project.name.slice(0, 1)}</span>
        <span className="eyebrow">{[form.organization, form.project.name].filter(Boolean).join(' · ')}</span>
        <h1>{form.name || 'Untitled form'}</h1>
        {form.description && <p className="muted">{form.description}</p>}
      </header>
      {form.questions.map((q, i) => (
        <div key={q.id} className={`pf-q${missing.includes(q.id) ? ' missing' : ''}`}>
          <label htmlFor={`q-${q.id}`}>
            <span className="pf-num">{String(i + 1).padStart(2, '0')}</span> {q.label}
            {q.required && <span className="pf-req" aria-label="required"> *</span>}
          </label>
          {q.help && <span className="pf-help muted small">{q.help}</span>}
          <Question q={q} value={answers[q.id]} onChange={(v) => set(q.id, v)} />
          {missing.includes(q.id) && <span className="pf-err small">This one's required</span>}
        </div>
      ))}
      {/* Honeypot: invisible to people, irresistible to bots. */}
      <input className="pf-hp" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} aria-hidden="true" name="website" />
      {submit.isError && !missing.length && <div className="form-error">{errorMessage(submit.error)}</div>}
      <button className="btn btn-volt btn-block pf-submit" disabled={submit.isPending || preview}>
        {submit.isPending ? <Spinner /> : <Send size={15} />} Submit
      </button>
    </form>
  );
}

function Question({ q, value, onChange }: { q: PublicForm['questions'][number]; value: Answers[string] | undefined; onChange: (v: Answers[string]) => void }) {
  const id = `q-${q.id}`;
  const str = typeof value === 'string' ? value : '';
  switch (q.kind) {
    case 'description':
      return <textarea id={id} rows={4} value={str} onChange={(e) => onChange(e.target.value)} maxLength={20000} />;
    case 'email':
      return <input id={id} type="email" value={str} onChange={(e) => onChange(e.target.value)} placeholder="you@company.com" autoComplete="email" />;
    case 'name':
      return <input id={id} value={str} onChange={(e) => onChange(e.target.value)} autoComplete="name" />;
    case 'dueDate':
      return <input id={id} type="date" value={str} onChange={(e) => onChange(e.target.value)} />;
    case 'priority':
      return (
        <div className="pf-choices" role="radiogroup" aria-labelledby={id}>
          {(['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const).map((p) => (
            <button type="button" key={p} role="radio" aria-checked={str === p} className={`pf-choice${str === p ? ' on' : ''}`} onClick={() => onChange(p)}>
              {PRIORITY_LABEL[p]}
            </button>
          ))}
        </div>
      );
    case 'type':
      return (
        <div className="pf-choices" role="radiogroup">
          {(['BUG', 'STORY', 'TASK'] as const).map((t) => (
            <button type="button" key={t} role="radio" aria-checked={str === t} className={`pf-choice${str === t ? ' on' : ''}`} onClick={() => onChange(t)}>
              {TYPE_LABEL[t]}
            </button>
          ))}
        </div>
      );
    case 'field': {
      const f = q.field!;
      if (f.type === 'SELECT' || f.type === 'MULTI_SELECT') {
        const multi = f.type === 'MULTI_SELECT';
        const chosen = multi ? ((value as string[]) ?? []) : [str];
        return (
          <div className="pf-choices" role={multi ? 'group' : 'radiogroup'}>
            {f.options.map((o) => {
              const on = chosen.includes(o.id);
              return (
                <button
                  type="button"
                  key={o.id}
                  role={multi ? 'checkbox' : 'radio'}
                  aria-checked={on}
                  className={`pf-choice${on ? ' on' : ''}`}
                  style={{ ['--c' as any]: o.color }}
                  onClick={() => onChange(multi ? (on ? chosen.filter((x) => x !== o.id) : [...chosen, o.id]) : o.id)}
                >
                  <span className="cf-dot" style={{ background: o.color }} /> {o.label}
                </button>
              );
            })}
          </div>
        );
      }
      if (f.type === 'CHECKBOX')
        return (
          <label className="check">
            <input id={id} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} /> Yes
          </label>
        );
      return <input id={id} type={f.type === 'NUMBER' ? 'number' : f.type === 'DATE' ? 'date' : f.type === 'URL' ? 'url' : 'text'} value={str} onChange={(e) => onChange(e.target.value)} />;
    }
    default:
      return <input id={id} value={str} onChange={(e) => onChange(e.target.value)} maxLength={500} />;
  }
}
