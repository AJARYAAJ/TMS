import { CalendarDays, CheckSquare, ExternalLink, Hash, Link2, ListChecks, Square, Tags, Type, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar } from '@/components/ui';
import { Picker } from '@/components/ui/Picker';
import { useUsers } from '@/features/projects/api';
import type { CustomField, FieldType, Task, TaskDetail } from '@/types';
import { formatDate } from '@/utils/format';
import { useFields } from './api';

type Value = string | number | boolean | string[] | undefined;

export const FIELD_ICON: Record<FieldType, typeof Type> = {
  TEXT: Type,
  NUMBER: Hash,
  SELECT: ListChecks,
  MULTI_SELECT: Tags,
  DATE: CalendarDays,
  CHECKBOX: CheckSquare,
  URL: Link2,
  PERSON: UserRound,
};

const hostOf = (url: string) => {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
};

/** Read-only rendering of a field value (List cells, cards, exports preview). */
export function FieldDisplay({ field, value, compact }: { field: CustomField; value: Value; compact?: boolean }) {
  const { data: users } = useUsers();
  if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) return <span className="cf-empty">—</span>;
  switch (field.type) {
    case 'SELECT':
    case 'MULTI_SELECT': {
      const ids = Array.isArray(value) ? value : [String(value)];
      const opts = ids.map((id) => field.options.find((o) => o.id === id)).filter(Boolean);
      return (
        <span className="cf-chips">
          {opts.slice(0, compact ? 2 : 10).map((o) => (
            <span key={o!.id} className="cf-chip" style={{ ['--c' as any]: o!.color }}>
              {o!.label}
            </span>
          ))}
          {compact && opts.length > 2 && <span className="muted small">+{opts.length - 2}</span>}
        </span>
      );
    }
    case 'CHECKBOX':
      return value ? <CheckSquare size={15} className="cf-check on" aria-label="Yes" /> : <Square size={15} className="cf-check" aria-label="No" />;
    case 'DATE':
      return <span className="cf-date">{formatDate(String(value))}</span>;
    case 'NUMBER':
      return <span className="cf-num">{Number(value).toLocaleString()}</span>;
    case 'URL':
      return (
        <a className="cf-url" href={String(value)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
          {hostOf(String(value))} <ExternalLink size={11} />
        </a>
      );
    case 'PERSON': {
      const u = users?.find((x) => x.id === value);
      return u ? (
        <span className="cf-person">
          <Avatar user={u} size={18} /> {compact ? u.name.split(' ')[0] : u.name}
        </span>
      ) : (
        <span className="cf-empty">—</span>
      );
    }
    default:
      return <span className="ellipsis">{String(value)}</span>;
  }
}

/** Inline editor for one field value. `onChange(null)` clears it. */
export function FieldEditor({ field, value, disabled, onChange }: { field: CustomField; value: Value; disabled?: boolean; onChange: (v: Value | null) => void }) {
  const { data: users } = useUsers();
  const [draft, setDraft] = useState(value === undefined ? '' : String(value));
  useEffect(() => setDraft(value === undefined ? '' : Array.isArray(value) ? value.join(',') : String(value)), [value]);
  const commit = () => {
    const v = draft.trim();
    if (v === (value === undefined ? '' : String(value))) return;
    onChange(v === '' ? null : field.type === 'NUMBER' ? Number(v) : v);
  };
  const input = (type: string, placeholder: string) => (
    <input
      className="cf-input"
      type={type}
      value={draft}
      disabled={disabled}
      placeholder={placeholder}
      aria-label={field.name}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );

  switch (field.type) {
    case 'TEXT':
      return input('text', 'Empty');
    case 'NUMBER':
      return input('number', '0');
    case 'URL':
      return (
        <span className="cf-url-edit">
          {input('url', 'https://…')}
          {value && <FieldDisplay field={field} value={value} />}
        </span>
      );
    case 'DATE':
      return (
        <input className="cf-input" type="date" value={value ? String(value) : ''} disabled={disabled} aria-label={field.name} onChange={(e) => onChange(e.target.value || null)} />
      );
    case 'CHECKBOX':
      return (
        <button type="button" className={`cf-toggle${value ? ' on' : ''}`} disabled={disabled} aria-pressed={!!value} aria-label={field.name} onClick={() => onChange(!value)}>
          {value ? <CheckSquare size={16} /> : <Square size={16} />} {value ? 'Yes' : 'No'}
        </button>
      );
    case 'SELECT':
    case 'MULTI_SELECT': {
      const multi = field.type === 'MULTI_SELECT';
      return (
        <Picker
          label={field.name}
          value={multi ? ((value as string[]) ?? []) : ((value as string) ?? null)}
          disabled={disabled}
          clearLabel={multi ? undefined : 'Clear'}
          options={field.options.map((o) => ({ value: o.id, label: o.label, icon: <span className="cf-dot" style={{ background: o.color }} /> }))}
          onChange={(v, all) => (multi ? onChange(all && all.length ? all : null) : onChange(v))}
        >
          <span className="cf-trigger">{value && (!Array.isArray(value) || value.length) ? <FieldDisplay field={field} value={value} /> : <span className="cf-empty">Select…</span>}</span>
        </Picker>
      );
    }
    case 'PERSON':
      return (
        <Picker
          label={field.name}
          value={(value as string) ?? null}
          disabled={disabled}
          searchable
          clearLabel="Nobody"
          options={(users ?? []).map((u) => ({ value: u.id, label: u.name, hint: u.email, icon: <Avatar user={u} size={18} /> }))}
          onChange={(v) => onChange(v)}
        >
          <span className="cf-trigger">{value ? <FieldDisplay field={field} value={value} /> : <span className="cf-empty">Pick someone…</span>}</span>
        </Picker>
      );
    default:
      return null;
  }
}

/** "Fields" section in the task sheet: every custom field of the project, editable inline. */
export function CustomFieldsSection({ task, canEdit, onSave }: { task: TaskDetail; canEdit: boolean; onSave: (patch: { customFields: Record<string, unknown> }, optimistic: Partial<Task>) => void }) {
  const { data: fields } = useFields(task.projectId);
  if (!fields?.length) {
    return canEdit ? (
      <p className="cf-hint muted small">
        Track anything with <Link to={`/projects/${task.key.split('-')[0]}/fields`}>custom fields</Link> — customer, revenue, go-live date…
      </p>
    ) : null;
  }
  const set = (f: CustomField, v: Value | null) => {
    const next = { ...(task.customFields ?? {}) };
    if (v === null || v === undefined) delete next[f.id];
    else next[f.id] = v as never;
    onSave({ customFields: { [f.id]: v ?? null } }, { customFields: next });
  };
  return (
    <section className="sheet-section">
      <div className="section-title">
        <h3>Fields</h3>
        <Link className="muted small" to={`/projects/${task.key.split('-')[0]}/fields`}>
          Manage
        </Link>
      </div>
      <dl className="cf-grid">
        {fields.map((f) => {
          const Icon = FIELD_ICON[f.type];
          return (
            <div key={f.id} className="cf-row">
              <dt>
                <Icon size={13} /> {f.name}
                {f.required && <span className="cf-req" title="Required on forms and imports">*</span>}
              </dt>
              <dd>
                <FieldEditor field={f} value={task.customFields?.[f.id]} disabled={!canEdit} onChange={(v) => set(f, v)} />
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
