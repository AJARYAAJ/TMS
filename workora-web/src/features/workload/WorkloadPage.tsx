import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Info } from 'lucide-react';
import { useState } from 'react';
import { Avatar, EmptyState, PriorityIcon, SkeletonRows } from '@/components/ui';
import { toast } from '@/components/ui/toast';
import { useCan, useSession } from '@/features/auth/session.store';
import { useProjects } from '@/features/projects/api';
import { useOpenTask } from '@/features/tasks/useOpenTask';
import { api, errorMessage } from '@/services/api/client';
import { qk } from '@/services/api/keys';
import type { Workload, WorkloadPerson } from '@/types';
import { formatDate } from '@/utils/format';

const hours = (m: number) => (m >= 60 ? `${Math.round((m / 60) * 10) / 10}h` : m ? `${m}m` : '0h');
const addDays = (s: string, n: number) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Load level for the sequential scale; "over" switches to the reserved critical status (with icon + label). */
function level(minutes: number, capacity: number) {
  if (!capacity) return minutes ? 'over' : 'l0';
  const r = minutes / capacity;
  if (r > 1) return 'over';
  if (r === 0) return 'l0';
  if (r <= 0.25) return 'l1';
  if (r <= 0.5) return 'l2';
  if (r <= 0.75) return 'l3';
  return 'l4';
}

/**
 * Workload (Asana/ClickUp style): who has how much estimated work in which week, against their
 * weekly capacity. Estimates are spread over working days from start to due date.
 */
export default function WorkloadPage() {
  const { data: projects } = useProjects();
  const [projectId, setProjectId] = useState('');
  const [from, setFrom] = useState<string | undefined>(undefined);
  const [weeks] = useState(6);
  const params = { projectId, from, weeks };
  const { data, isLoading } = useQuery({
    queryKey: qk.workload(params),
    queryFn: () => api.get<Workload>('/workload', { projectId: projectId || undefined, from, weeks }),
    placeholderData: (prev) => prev,
  });
  const [open, setOpen] = useState<string | null>(null);
  const shift = (n: number) => data && setFrom(addDays(data.from, n * 7));

  return (
    <div className="page workload-page">
      <header className="page-head">
        <div>
          <span className="eyebrow">Capacity planning</span>
          <h1 className="display-sm">Workload</h1>
        </div>
        <div className="toolbar">
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Project">
            <option value="">All projects</option>
            {projects?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="seg">
            <button onClick={() => shift(-1)} aria-label="Previous week">
              <ChevronLeft size={14} />
            </button>
            <button onClick={() => setFrom(undefined)}>This week</button>
            <button onClick={() => shift(1)} aria-label="Next week">
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </header>

      <div className="wl-legend muted small" aria-label="Legend">
        <span>Load vs. weekly capacity:</span>
        {(['l1', 'l2', 'l3', 'l4'] as const).map((l, i) => (
          <span key={l} className="wl-key">
            <span className={`wl-swatch ${l}`} /> ≤{(i + 1) * 25}%
          </span>
        ))}
        <span className="wl-key">
          <span className="wl-swatch over" /> <AlertTriangle size={12} /> over capacity
        </span>
        <span className="wl-key" title="Estimates are spread evenly across working days between a task's start and due date. Overdue work counts in the first week.">
          <Info size={12} /> how it's calculated
        </span>
      </div>

      {isLoading || !data ? (
        <SkeletonRows rows={6} />
      ) : !data.people.length ? (
        <EmptyState title="No members yet">Invite teammates in Admin to plan their workload.</EmptyState>
      ) : (
        <section className="tile wl-tile">
          <div className="wl-grid" role="table" aria-label="Workload by person and week" style={{ ['--weeks' as any]: data.weeks.length }}>
            <div className="wl-row wl-head" role="row">
              <span role="columnheader">Person</span>
              {data.weeks.map((w) => (
                <span key={w} role="columnheader" className="wl-week">
                  {formatDate(w)}
                </span>
              ))}
              <span role="columnheader">No date</span>
            </div>
            {data.people.map((p) => (
              <PersonRow key={p.user.id} person={p} weeks={data.weeks} open={open === p.user.id} onToggle={() => setOpen(open === p.user.id ? null : p.user.id)} />
            ))}
          </div>
          {data.unassigned.count > 0 && (
            <p className="muted small wl-foot">
              {data.unassigned.count} open {data.unassigned.count === 1 ? 'task is' : 'tasks are'} unassigned ({hours(data.unassigned.minutes)} estimated).
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function PersonRow({ person, weeks, open, onToggle }: { person: WorkloadPerson; weeks: string[]; open: boolean; onToggle: () => void }) {
  const openTask = useOpenTask();
  const me = useSession()!.user.id;
  const canEdit = useCan('ADMIN') || person.user.id === me;
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [cap, setCap] = useState(String(person.capacityMinutes / 60));
  const save = useMutation({
    mutationFn: (h: number) => api.patch(`/workload/capacity/${person.user.id}`, { hoursPerWeek: h }),
    onSuccess: () => {
      setEditing(false);
      qc.invalidateQueries({ queryKey: ['workload'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const peak = Math.max(0, ...person.weeks.map((w) => w.minutes));

  return (
    <>
      <div className={`wl-row${open ? ' open' : ''}`} role="row">
        <span className="wl-person" role="rowheader">
          <button className="wl-expand" onClick={onToggle} aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} ${person.user.name}'s tasks`}>
            {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          <Avatar user={person.user} size={28} />
          <span className="wl-name">
            <strong className="ellipsis">{person.user.name}</strong>
            {editing ? (
              <form
                className="wl-cap-edit"
                onSubmit={(e) => {
                  e.preventDefault();
                  const h = Number(cap);
                  if (Number.isInteger(h) && h >= 0 && h <= 80) save.mutate(h);
                  else toast.error('Capacity is whole hours from 0 to 80');
                }}
              >
                <input autoFocus type="number" min={0} max={80} value={cap} onChange={(e) => setCap(e.target.value)} aria-label="Hours per week" onBlur={() => setEditing(false)} />
                h/wk
              </form>
            ) : (
              <button className="wl-cap" disabled={!canEdit} onClick={() => setEditing(true)} title={canEdit ? 'Change weekly capacity' : undefined}>
                {hours(person.capacityMinutes)}/wk · {person.openTasks} open{person.unestimated ? ` · ${person.unestimated} unestimated` : ''}
              </button>
            )}
          </span>
        </span>
        {person.weeks.map((w, i) => {
          const lv = level(w.minutes, person.capacityMinutes);
          const pct = person.capacityMinutes ? Math.round((w.minutes / person.capacityMinutes) * 100) : 0;
          return (
            <span
              key={weeks[i]}
              role="cell"
              className={`wl-cell ${lv}`}
              title={`${person.user.name}, week of ${formatDate(weeks[i])}: ${hours(w.minutes)} of ${hours(person.capacityMinutes)} (${pct}%) across ${w.count} task(s)`}
            >
              <span className="wl-fill" style={{ height: `${Math.min(100, pct)}%` }} />
              <span className="wl-val">
                {lv === 'over' && <AlertTriangle size={11} aria-label="Over capacity" />}
                {w.minutes ? hours(w.minutes) : '·'}
              </span>
              {w.minutes === peak && peak > 0 && <span className="sr-only">peak week</span>}
            </span>
          );
        })}
        <span role="cell" className="wl-cell wl-nodate">
          {person.unscheduled.count ? `${person.unscheduled.count} ${person.unscheduled.count === 1 ? 'task' : 'tasks'}${person.unscheduled.minutes ? ` · ${hours(person.unscheduled.minutes)}` : ''}` : '·'}
        </span>
      </div>
      {open && (
        <div className="wl-tasks" role="row">
          {person.tasks.length ? (
            person.tasks.map((t) => (
              <button key={t.id} className="wl-task" onClick={() => openTask(t.key)}>
                <PriorityIcon priority={t.priority} />
                <span className="task-key">{t.key}</span>
                <span className="ellipsis">{t.title}</span>
                <span className={`muted small${t.overdue ? ' text-danger' : ''}`}>{t.dueDate ? `due ${formatDate(t.dueDate)}` : 'no due date'}</span>
                <span className="wl-mini" aria-hidden>
                  {weeks.map((w, i) => (
                    <span key={w} style={{ opacity: t.weeks[i] ? 0.35 + Math.min(0.65, t.weeks[i] / 600) : 0.08 }} />
                  ))}
                </span>
                <span className="small nowrap">{t.minutes ? hours(t.minutes) : 'no estimate'}</span>
              </button>
            ))
          ) : (
            <p className="muted small">No open tasks.</p>
          )}
        </div>
      )}
    </>
  );
}
