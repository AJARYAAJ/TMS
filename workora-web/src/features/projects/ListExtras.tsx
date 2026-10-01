import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, BookmarkPlus, Check, Download, FileUp, Filter, Share2, Trash2, Upload, Users, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { Dialog, Spinner } from '@/components/ui';
import { Picker } from '@/components/ui/Picker';
import { toast } from '@/components/ui/toast';
import { config } from '@/config';
import { useCan, useSessionStore } from '@/features/auth/session.store';
import { FieldEditor, FIELD_ICON } from '@/features/fields/FieldValues';
import { useFields } from '@/features/fields/api';
import type { TaskFilters } from '@/features/tasks/api';
import { api, errorMessage } from '@/services/api/client';
import { qk } from '@/services/api/keys';
import type { ImportPreview, Project, SavedView } from '@/types';

export type CfFilter = Record<string, unknown>;

/* ─────────── Saved views ─────────── */

export function useViews(projectId: string) {
  return useQuery({ queryKey: qk.views(projectId), queryFn: () => api.get<SavedView[]>('/views', { projectId }) });
}

/** Named filter sets: pick one to apply it, save the current filters as a new (optionally shared) view. */
export function SavedViewsBar({ projectId, filters, cf, onApply }: { projectId: string; filters: TaskFilters; cf: CfFilter; onApply: (filters: TaskFilters, cf: CfFilter, id: string | null) => void }) {
  const qc = useQueryClient();
  const { data: views } = useViews(projectId);
  const canShare = useCan('MEMBER');
  const [active, setActive] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: qk.views(projectId) });
  const { page: _p, size: _s, projectId: _pid, ...keep } = filters;
  const create = useMutation({
    mutationFn: () => api.post<SavedView>('/views', { name, projectId, shared, config: { filters: keep, cf } }),
    onSuccess: (v) => {
      refresh();
      setActive(v.id);
      setSaving(false);
      setName('');
      toast.success(`View “${v.name}” saved${v.shared ? ' and shared' : ''}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const updateView = useMutation({
    mutationFn: (v: SavedView) => api.patch<SavedView>(`/views/${v.id}`, { config: { filters: keep, cf } }),
    onSuccess: (v) => {
      refresh();
      toast.success(`Updated “${v.name}”`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/views/${id}`),
    onSuccess: () => {
      refresh();
      setActive(null);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const current = views?.find((v) => v.id === active);

  return (
    <div className="views-bar" role="tablist" aria-label="Saved views">
      <button role="tab" aria-selected={!active} className={`view-chip${!active ? ' active' : ''}`} onClick={() => {
        setActive(null);
        onApply({ sort: 'position', order: 'asc' }, {}, null);
      }}>
        All tasks
      </button>
      {views?.map((v) => (
        <button
          key={v.id}
          role="tab"
          aria-selected={active === v.id}
          className={`view-chip${active === v.id ? ' active' : ''}`}
          onClick={() => {
            setActive(v.id);
            onApply({ sort: 'position', order: 'asc', ...(v.config.filters as TaskFilters) }, (v.config.cf as CfFilter) ?? {}, v.id);
          }}
          title={v.shared ? (v.mine ? 'Shared by you' : 'Shared with the workspace') : 'Only you see this view'}
        >
          {v.shared ? <Users size={12} /> : <Bookmark size={12} />} {v.name}
        </button>
      ))}
      {current && (current.mine || canShare) && (
        <span className="view-tools">
          <button className="icon-btn" title="Save current filters into this view" aria-label="Update view" onClick={() => updateView.mutate(current)}>
            <Check size={14} />
          </button>
          {current.mine && (
            <button className="icon-btn danger" aria-label={`Delete view ${current.name}`} onClick={() => confirm(`Delete view “${current.name}”?`) && remove.mutate(current.id)}>
              <Trash2 size={14} />
            </button>
          )}
        </span>
      )}
      {saving ? (
        <form
          className="view-save"
          onSubmit={(e) => {
            e.preventDefault();
            name.trim() && create.mutate();
          }}
        >
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="View name" aria-label="View name" maxLength={80} />
          {canShare && (
            <label className="check" title="Everyone in the workspace sees shared views">
              <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> <Share2 size={12} /> Share
            </label>
          )}
          <button className="btn btn-volt btn-sm" disabled={!name.trim() || create.isPending}>
            Save
          </button>
          <button type="button" className="icon-btn" aria-label="Cancel" onClick={() => setSaving(false)}>
            <X size={14} />
          </button>
        </form>
      ) : (
        <button className="view-chip add" onClick={() => setSaving(true)}>
          <BookmarkPlus size={13} /> Save view
        </button>
      )}
    </div>
  );
}

/* ─────────── Custom field filter ─────────── */

/** Filter chips for custom fields: pick a field, then a value (select → option, checkbox → yes/no, …). */
export function FieldFilter({ projectId, cf, onChange }: { projectId: string; cf: CfFilter; onChange: (cf: CfFilter) => void }) {
  const { data: fields } = useFields(projectId);
  if (!fields?.length) return null;
  const active = fields.filter((f) => f.id in cf);
  const available = fields.filter((f) => !(f.id in cf) && f.type !== 'TEXT' && f.type !== 'URL');
  return (
    <span className="cf-filters">
      {active.map((f) => {
        const Icon = FIELD_ICON[f.type];
        return (
          <span key={f.id} className="cf-filter">
            <Icon size={12} /> {f.name}:
            <FieldEditor
              field={f}
              value={(cf[f.id] ?? undefined) as never}
              onChange={(v) => onChange({ ...cf, [f.id]: Array.isArray(v) ? v[v.length - 1] : v === undefined ? null : v })}
            />
            <button className="icon-btn" aria-label={`Remove ${f.name} filter`} onClick={() => {
              const next = { ...cf };
              delete next[f.id];
              onChange(next);
            }}>
              <X size={12} />
            </button>
          </span>
        );
      })}
      {available.length > 0 && (
        <Picker
          label="Filter by field"
          value={null}
          options={available.map((f) => {
            const Icon = FIELD_ICON[f.type];
            return { value: f.id, label: f.name, icon: <Icon size={14} /> };
          })}
          onChange={(id) => id && onChange({ ...cf, [id]: fields.find((f) => f.id === id)!.type === 'CHECKBOX' ? true : null })}
        >
          <span className="btn btn-ghost btn-sm">
            <Filter size={13} /> Field
          </span>
        </Picker>
      )}
    </span>
  );
}

/* ─────────── CSV import / export ─────────── */

export async function downloadCsv(project: Project) {
  const token = useSessionStore.getState().session?.token;
  const res = await fetch(`${config.apiBase}/projects/${project.id}/export.csv`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error('Export failed');
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? `${project.key}.csv`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const TARGET_LABEL: Record<string, string> = {
  title: 'Title',
  description: 'Description',
  type: 'Type',
  status: 'Status',
  priority: 'Priority',
  assignee: 'Assignee',
  labels: 'Labels',
  storyPoints: 'Story points',
  estimateHours: 'Estimate (hours)',
  startDate: 'Start date',
  dueDate: 'Due date',
  parent: 'Parent (key)',
  ignore: '— Skip —',
};

/** Upload → preview with column mapping, row problems and new labels → import. */
export function ImportDialog({ project, open, onClose }: { project: Project; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportPreview | null>(null);
  const run = useMutation({
    mutationFn: (vars: { csv: string; mapping: Record<string, string>; dryRun: boolean }) => api.post<ImportPreview>(`/projects/${project.id}/import`, vars),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const reset = () => {
    setCsv(null);
    setPreview(null);
    setResult(null);
    setMapping({});
    setFileName('');
  };
  const analyse = (text: string, map: Record<string, string>) =>
    run.mutate({ csv: text, mapping: map, dryRun: true }, { onSuccess: (p) => { setPreview(p); setMapping(p.mapping); } });
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 4_000_000) return toast.error('Files up to 4 MB, please');
    const text = await f.text();
    setFileName(f.name);
    setCsv(text);
    analyse(text, {});
  };
  const label = (t: string) => TARGET_LABEL[t] ?? (t.startsWith('field:') ? `Field · ${preview?.fields.find((f) => `field:${f.id}` === t)?.name}` : t);

  return (
    <Dialog open={open} onClose={() => { reset(); onClose(); }} title={`Import tasks into ${project.name}`} width={720}>
      {result ? (
        <div className="import-done">
          <p className="unsub-done">
            <Check size={18} /> Imported {result.created} {result.created === 1 ? 'task' : 'tasks'}
            {result.keys?.length ? ` (${result.keys[0]} – ${result.keys.at(-1)})` : ''}.
          </p>
          {!!result.failed?.length && <p className="text-danger small">{result.failed.length} rows failed: {result.failed.slice(0, 3).map((f) => `row ${f.row}: ${f.message}`).join('; ')}</p>}
          <button className="btn btn-volt" onClick={() => { reset(); onClose(); }}>
            Done
          </button>
        </div>
      ) : !csv ? (
        <div
          className="dropzone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            onFile(e.dataTransfer.files[0]);
          }}
          onClick={() => file.current?.click()}
          role="button"
          tabIndex={0}
        >
          <FileUp size={28} />
          <strong>Drop a CSV here or click to choose</strong>
          <span className="muted small">Exports from Jira, Asana, Trello, ClickUp, Linear or a spreadsheet. Columns are matched automatically; up to 1,000 rows.</span>
          <input ref={file} type="file" accept=".csv,text/csv,.tsv" hidden onChange={(e) => onFile(e.target.files?.[0])} aria-label="CSV file" />
        </div>
      ) : !preview ? (
        <p className="muted">
          <Spinner /> Reading {fileName}…
        </p>
      ) : (
        <div className="import-preview">
          <p className="muted small">
            <strong>{fileName}</strong> · {preview.total} rows · <span className={preview.valid === preview.total ? 'text-success' : ''}>{preview.valid} ready</span>
            {preview.newLabels.length > 0 && <> · new labels: {preview.newLabels.join(', ')}</>}
          </p>
          <div className="map-grid">
            {preview.columns.map((col) => (
              <label key={col} className="map-row">
                <span className="map-col ellipsis" title={col}>
                  {col}
                </span>
                <span className="map-arrow">→</span>
                <select value={mapping[col]} onChange={(e) => setMapping({ ...mapping, [col]: e.target.value })} aria-label={`Map ${col}`}>
                  {preview.targets.map((t) => (
                    <option key={t} value={t}>
                      {label(t)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {preview.problems.length > 0 && (
            <details className="problems" open={preview.valid < preview.total}>
              <summary>{preview.problems.length} rows need attention</summary>
              <ul>
                {preview.problems.map((p) => (
                  <li key={p.row}>
                    <strong>Row {p.row}</strong> {p.errors.map((e) => <span key={e} className="text-danger"> · {e}</span>)}
                    {p.warnings.map((w) => <span key={w} className="muted"> · {w}</span>)}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="row-actions">
            <button className="btn btn-ghost" onClick={() => analyse(csv, mapping)} disabled={run.isPending}>
              Re-check mapping
            </button>
            <button
              className="btn btn-volt"
              disabled={run.isPending || !preview.valid}
              onClick={() =>
                run.mutate(
                  { csv, mapping, dryRun: false },
                  {
                    onSuccess: (r) => {
                      setResult(r);
                      qc.invalidateQueries({ queryKey: ['tasks'] });
                      qc.invalidateQueries({ queryKey: qk.board(project.id) });
                      qc.invalidateQueries({ queryKey: qk.labels });
                    },
                  },
                )
              }
            >
              {run.isPending ? <Spinner /> : <Upload size={14} />} Import {preview.valid} {preview.valid === 1 ? 'task' : 'tasks'}
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

export function CsvButtons({ project }: { project: Project }) {
  const canImport = useCan('MEMBER');
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <span className="csv-buttons">
      <button
        className="btn btn-ghost btn-sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await downloadCsv(project);
          } catch (e) {
            toast.error(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <Spinner size={12} /> : <Download size={13} />} Export
      </button>
      {canImport && (
        <button className="btn btn-ghost btn-sm" onClick={() => setImporting(true)}>
          <Upload size={13} /> Import
        </button>
      )}
      <ImportDialog project={project} open={importing} onClose={() => setImporting(false)} />
    </span>
  );
}
