import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUiStore } from '@/app/ui.store';
import { Dialog, Spinner } from '@/components/ui';
import { toast } from '@/components/ui/toast';
import { errorMessage } from '@/services/api/client';
import { useCreateProject } from './api';

const COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

export function CreateProjectDialog() {
  const open = useUiStore((s) => s.createProjectOpen);
  const setOpen = useUiStore((s) => s.setCreateProject);
  const create = useCreateProject();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', key: '', description: '', color: COLORS[0] });

  useEffect(() => {
    if (open) {
      setForm({ name: '', key: '', description: '', color: COLORS[Math.floor(Math.random() * COLORS.length)] });
      create.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(
      { name: form.name, key: form.key || undefined, description: form.description, color: form.color },
      {
        onSuccess: (p) => {
          setOpen(false);
          toast.success(`Project ${p.name} created`);
          navigate(`/projects/${p.key}/board`);
        },
      },
    );
  };

  return (
    <Dialog open={open} onClose={() => setOpen(false)} title="Create project">
      <form className="form dialog-body" onSubmit={submit}>
        <label>
          Name
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="E-Commerce Platform" required maxLength={120} autoFocus />
        </label>
        <label>
          Key <span className="muted small">(optional — used in task IDs like ECOM-102)</span>
          <input
            value={form.key}
            onChange={(e) => setForm({ ...form, key: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) })}
            placeholder="Auto-generated"
            pattern="[A-Z][A-Z0-9]{1,9}"
          />
        </label>
        <label>
          Description
          <textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </label>
        <div className="color-picker" role="radiogroup" aria-label="Color">
          {COLORS.map((c) => (
            <button type="button" key={c} role="radio" aria-checked={form.color === c} className={form.color === c ? 'selected' : ''} style={{ background: c }} onClick={() => setForm({ ...form, color: c })} />
          ))}
        </div>
        {create.isError && <div className="form-error">{errorMessage(create.error)}</div>}
        <div className="dialog-footer">
          <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={create.isPending}>
            {create.isPending ? <Spinner /> : 'Create project'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
