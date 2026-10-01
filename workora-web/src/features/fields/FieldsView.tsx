import { ArrowDown, ArrowUp, Eye, EyeOff, GripVertical, Plus, Trash2, X } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { EmptyState, SkeletonRows } from '@/components/ui';
import { useCan } from '@/features/auth/session.store';
import { useProjectContext } from '@/features/projects/ProjectLayout';
import type { CustomField, FieldType } from '@/types';
import { FIELD_TYPES, useFieldMutations, useFields } from './api';
import { FIELD_ICON } from './FieldValues';

const SWATCHES = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#ec4899', '#14b8a6', '#8b5cf6', '#64748b'];
const hasOptions = (t: FieldType) => t === 'SELECT' || t === 'MULTI_SELECT';

/** Project → Fields: define the custom fields every task in this project can carry. */
export default function FieldsView() {
  const project = useProjectContext();
  const { data: fields, isLoading } = useFields(project.id);
  const canEdit = useCan('MEMBER');
  const m = useFieldMutations(project.id);
  const [adding, setAdding] = useState<FieldType | null>(null);

  return (
    <div className="page fields-page">
      <div className="fields-intro">
        <div>
          <h2>Custom fields</h2>
          <p className="muted">Capture what matters to this project — customer, revenue, platform, go-live. Fields appear in the task sheet, as List columns, in filters, on intake forms and in CSV import/export.</p>
        </div>
      </div>

      {canEdit && (
        <div className="type-palette" role="group" aria-label="Add a field">
          {FIELD_TYPES.map(({ type, label, hint }) => {
            const Icon = FIELD_ICON[type];
            return (
              <button key={type} className={`type-tile${adding === type ? ' active' : ''}`} onClick={() => setAdding(adding === type ? null : type)} title={hint}>
                <Icon size={18} />
                <strong>{label}</strong>
                <span className="muted small">{hint}</span>
              </button>
            );
          })}
        </div>
      )}

      {adding && <NewField type={adding} onDone={() => setAdding(null)} projectId={project.id} />}

      <section className="tile">
        {isLoading ? (
          <SkeletonRows rows={4} />
        ) : fields?.length ? (
          <ul className="field-list">
            {fields.map((f, i) => (
              <FieldRow key={f.id} field={f} index={i} last={i === fields.length - 1} canEdit={canEdit} projectId={project.id} />
            ))}
          </ul>
        ) : (
          <EmptyState title="No custom fields yet">Pick a type above to add your first field.</EmptyState>
        )}
      </section>
      {m.create.isPending && <span className="muted small">Saving…</span>}
    </div>
  );
}

function OptionsEditor({ options, onChange }: { options: { id?: string; label: string; color: string }[]; onChange: (o: { id?: string; label: string; color: string }[]) => void }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const label = draft.trim();
    if (!label || options.some((o) => o.label.toLowerCase() === label.toLowerCase())) return;
    onChange([...options, { label, color: SWATCHES[options.length % SWATCHES.length] }]);
    setDraft('');
  };
  return (
    <div className="opt-editor">
      {options.map((o, i) => (
        <span key={o.id ?? `${o.label}-${i}`} className="opt-pill" style={{ ['--c' as any]: o.color }}>
          <button
            type="button"
            className="opt-swatch"
            aria-label={`Change colour of ${o.label}`}
            onClick={() => onChange(options.map((x, j) => (j === i ? { ...x, color: SWATCHES[(SWATCHES.indexOf(x.color) + 1) % SWATCHES.length] } : x)))}
          />
          <input value={o.label} aria-label="Option label" onChange={(e) => onChange(options.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
          <button type="button" className="icon-btn" aria-label={`Remove ${o.label}`} onClick={() => onChange(options.filter((_, j) => j !== i))}>
            <X size={12} />
          </button>
        </span>
      ))}
      <input
        className="opt-new"
        value={draft}
        placeholder="Add option ↵"
        aria-label="New option"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />
    </div>
  );
}

function NewField({ type, projectId, onDone }: { type: FieldType; projectId: string; onDone: () => void }) {
  const { create } = useFieldMutations(projectId);
  const [name, setName] = useState('');
  const [options, setOptions] = useState<{ label: string; color: string }[]>([]);
  const [required, setRequired] = useState(false);
  const meta = FIELD_TYPES.find((t) => t.type === type)!;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate({ name, type, options: hasOptions(type) ? options : undefined, required }, { onSuccess: onDone });
  };
  return (
    <form className="tile new-field" onSubmit={submit}>
      <div className="form-row">
        <label>
          {meta.label} field name
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={type === 'SELECT' ? 'e.g. Customer tier' : type === 'PERSON' ? 'e.g. Reviewer' : 'e.g. Customer'} required maxLength={60} />
        </label>
      </div>
      {hasOptions(type) && (
        <label className="block-label">
          Options
          <OptionsEditor options={options} onChange={setOptions} />
        </label>
      )}
      <label className="check">
        <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> Required on intake forms and CSV imports
      </label>
      <div className="row-actions">
        <button className="btn btn-volt" disabled={create.isPending || !name.trim() || (hasOptions(type) && !options.length)}>
          <Plus size={14} /> Add field
        </button>
        <button type="button" className="btn btn-ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function FieldRow({ field, index, last, canEdit, projectId }: { field: CustomField; index: number; last: boolean; canEdit: boolean; projectId: string }) {
  const { update, remove } = useFieldMutations(projectId);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(field.name);
  const [options, setOptions] = useState(field.options);
  const Icon = FIELD_ICON[field.type];
  const typeLabel = FIELD_TYPES.find((t) => t.type === field.type)!.label;
  return (
    <li className={`field-item${open ? ' open' : ''}`}>
      <div className="field-head">
        <GripVertical size={14} className="muted" />
        <span className="field-icon">
          <Icon size={15} />
        </span>
        <button className="field-name" onClick={() => canEdit && setOpen(!open)} disabled={!canEdit}>
          {field.name}
        </button>
        <span className="pill pill-soft">{typeLabel}</span>
        {field.required && <span className="pill pill-soft">required</span>}
        {hasOptions(field.type) && (
          <span className="cf-chips">
            {field.options.slice(0, 5).map((o) => (
              <span key={o.id} className="cf-chip" style={{ ['--c' as any]: o.color }}>
                {o.label}
              </span>
            ))}
          </span>
        )}
        {canEdit && (
          <span className="ml-auto row-tools">
            <button className="icon-btn" title={field.showInList ? 'Shown as a List column' : 'Hidden from List'} aria-label={`${field.showInList ? 'Hide' : 'Show'} ${field.name} in List`} onClick={() => update.mutate({ id: field.id, showInList: !field.showInList })}>
              {field.showInList ? <Eye size={14} /> : <EyeOff size={14} />}
            </button>
            <button className="icon-btn" aria-label={`Move ${field.name} up`} disabled={index === 0} onClick={() => update.mutate({ id: field.id, position: index - 1 })}>
              <ArrowUp size={14} />
            </button>
            <button className="icon-btn" aria-label={`Move ${field.name} down`} disabled={last} onClick={() => update.mutate({ id: field.id, position: index + 1 })}>
              <ArrowDown size={14} />
            </button>
            <button className="icon-btn danger" aria-label={`Delete ${field.name}`} onClick={() => confirm(`Delete “${field.name}”? Its values are removed from every task.`) && remove.mutate(field.id)}>
              <Trash2 size={14} />
            </button>
          </span>
        )}
      </div>
      {open && (
        <form
          className="field-edit"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate({ id: field.id, name, options: hasOptions(field.type) ? options : undefined }, { onSuccess: () => setOpen(false) });
          }}
        >
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
          </label>
          {hasOptions(field.type) && (
            <label className="block-label">
              Options <span className="muted small">(renaming keeps task values; removing an option clears it from tasks)</span>
              <OptionsEditor options={options} onChange={(o) => setOptions(o as typeof options)} />
            </label>
          )}
          <label className="check">
            <input type="checkbox" checked={field.required} onChange={() => update.mutate({ id: field.id, required: !field.required })} /> Required on forms and imports
          </label>
          <div className="row-actions">
            <button className="btn btn-volt btn-sm">Save</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </form>
      )}
    </li>
  );
}
