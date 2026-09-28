import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Map } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { EmptyState, SkeletonRows } from '@/components/ui';
import { useOpenTask } from '@/features/tasks/useOpenTask';
import { api } from '@/services/api/client';
import { qk } from '@/services/api/keys';
import type { RoadmapItem } from '@/types';
import { formatDate, todayIso } from '@/utils/format';

const MONTHS = 4;

/** Roadmap: epics across projects on a month grid, with progress rolled up from their tasks. */
export default function RoadmapPage() {
  const { projectKey } = useParams();
  const { data, isLoading } = useQuery({ queryKey: qk.roadmap(projectKey), queryFn: () => api.get<RoadmapItem[]>('/roadmap', projectKey ? { projectId: projectKey } : undefined) });
  const openTask = useOpenTask();
  const [offset, setOffset] = useState(-1);
  const start = new Date();
  start.setDate(1);
  start.setMonth(start.getMonth() + offset);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setMonth(end.getMonth() + MONTHS);
  const span = end.getTime() - start.getTime();
  const pos = (iso: string) => ((new Date(`${iso}T00:00:00`).getTime() - start.getTime()) / span) * 100;
  const months = Array.from({ length: MONTHS }, (_, i) => new Date(start.getFullYear(), start.getMonth() + i, 1));
  const today = pos(todayIso());
  const scheduled = (data ?? []).filter((e) => e.startDate || e.dueDate);
  const unscheduled = (data ?? []).filter((e) => !e.startDate && !e.dueDate);

  return (
    <div className="page page-wide">
      {!projectKey && (
        <header className="page-head">
          <div>
            <span className="eyebrow">Epics across every project</span>
            <h1 className="display-sm">Roadmap</h1>
          </div>
        </header>
      )}
      <div className="toolbar">
        <div className="seg">
          <button onClick={() => setOffset(offset - 1)} aria-label="Earlier">
            <ChevronLeft size={15} />
          </button>
          <button onClick={() => setOffset(-1)}>Today</button>
          <button onClick={() => setOffset(offset + 1)} aria-label="Later">
            <ChevronRight size={15} />
          </button>
        </div>
        <span className="muted small">Epics are tasks of type Epic; their bars span their own dates or their children's.</span>
      </div>
      {isLoading ? (
        <SkeletonRows rows={5} />
      ) : !data?.length ? (
        <EmptyState icon={<Map size={32} />} title="No epics yet">
          Create a task with type “Epic”, then nest tasks under it to see it on the roadmap.
        </EmptyState>
      ) : (
        <div className="roadmap tile">
          <div className="rm-head">
            <div className="rm-label" />
            <div className="rm-track">
              {months.map((m, i) => (
                <span key={i} className="rm-month" style={{ left: `${(i / MONTHS) * 100}%`, width: `${100 / MONTHS}%` }}>
                  {m.toLocaleDateString(undefined, { month: 'long', year: m.getMonth() === 0 || i === 0 ? 'numeric' : undefined })}
                </span>
              ))}
            </div>
          </div>
          {scheduled.map((e) => {
            const s = pos(e.startDate ?? e.dueDate!);
            const f = pos(e.dueDate ?? e.startDate!);
            const left = Math.max(0, Math.min(s, f));
            const right = Math.min(100, Math.max(s, f) + 100 / (MONTHS * 30));
            const visible = right > 0 && left < 100;
            return (
              <div key={e.id} className="rm-row">
                <button className="rm-label" onClick={() => openTask(e.key)}>
                  <span className="dot" style={{ background: e.projectColor }} />
                  <span className="rm-name">
                    <span className="ellipsis">{e.title}</span>
                    <span className="muted small">
                      {e.key} · {e.childDone}/{e.childCount} tasks
                    </span>
                  </span>
                </button>
                <div className="rm-track">
                  {months.map((_, i) => (
                    <span key={i} className="rm-grid" style={{ left: `${(i / MONTHS) * 100}%` }} />
                  ))}
                  {today >= 0 && today <= 100 && <span className="rm-today" style={{ left: `${today}%` }} />}
                  {visible && (
                    <button
                      className={`rm-bar${e.status === 'DONE' ? ' done' : ''}`}
                      style={{ left: `${left}%`, width: `${Math.max(2, right - left)}%`, ['--app' as any]: e.projectColor }}
                      onClick={() => openTask(e.key)}
                      title={`${e.title}: ${formatDate(e.startDate)} → ${formatDate(e.dueDate)} · ${e.progress}%`}
                    >
                      <span className="rm-fill" style={{ width: `${e.progress}%` }} />
                      <span className="rm-text">{e.progress}%</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {unscheduled.length > 0 && (
            <p className="muted small rm-unscheduled">
              Unscheduled: {unscheduled.map((e) => e.key).join(', ')} — add dates to place them.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
