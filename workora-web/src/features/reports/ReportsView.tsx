import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { EmptyState, ProgressBar, Skeleton, SkeletonRows } from '@/components/ui';
import { useProjectContext } from '@/features/projects/ProjectLayout';
import { useProjects } from '@/features/projects/api';
import { api } from '@/services/api/client';
import { qk } from '@/services/api/keys';
import { TASK_PRIORITIES } from '@/types';
import { formatDate, PRIORITY_LABEL } from '@/utils/format';

interface ProjectReport {
  total: number;
  completed: number;
  overdue: number;
  unassigned: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  workload: { id: string; name: string; total: number; open: number; openPoints: number }[];
  trend: { date: string; completed: number; created: number }[];
  byState: { id: string; name: string; color: string; category: string; wipLimit: number | null; count: number }[];
  activeSprint: null | { name: string; startDate: string; endDate: string; total: number; done: number; points: number; donePoints: number };
}

/** Project analytics. Lazy-loaded: the chart code only downloads when someone opens Reports. */
export default function ReportsView() {
  const project = useProjectContext();
  const { data, isLoading } = useQuery({ queryKey: qk.reports(project.id), queryFn: () => api.get<ProjectReport>(`/projects/${project.id}/reports`) });

  if (isLoading || !data) {
    return (
      <div className="page">
        <div className="stat-grid">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="stat-card">
              <Skeleton width={80} />
              <Skeleton width={40} height={26} style={{ marginTop: 8 }} />
            </div>
          ))}
        </div>
        <SkeletonRows rows={6} />
      </div>
    );
  }
  if (data.total === 0) return <div className="page"><EmptyState title="No data yet">Reports appear once the project has tasks.</EmptyState></div>;

  return (
    <div className="page viz-root">
      <div className="stat-grid">
        <Stat label="Total tasks" value={data.total} />
        <Stat label="Completed" value={data.completed} sub={`${Math.round((data.completed / data.total) * 100)}%`} />
        <Stat label="Overdue" value={data.overdue} />
        <Stat label="Unassigned (open)" value={data.unassigned} />
      </div>

      <div className="dashboard-grid">
        <section className="tile">
          <h2>Tasks by workflow state</h2>
          <BarList
            rows={(data.byState ?? []).map((st) => ({ label: st.name, value: st.count, note: st.wipLimit && st.count > st.wipLimit ? `over WIP ${st.wipLimit}` : undefined }))}
            unit="tasks"
          />
        </section>
        <section className="tile">
          <h2>Tasks by priority</h2>
          <BarList rows={TASK_PRIORITIES.map((p) => ({ label: PRIORITY_LABEL[p], value: data.byPriority[p] ?? 0 }))} unit="tasks" />
        </section>
        <section className="tile span-2">
          <h2>Created vs completed · last 14 days</h2>
          <TrendChart trend={data.trend} />
        </section>
        <section className="tile">
          <h2>Open work by assignee</h2>
          {data.workload.length ? (
            <BarList rows={data.workload.map((w) => ({ label: w.name, value: w.open, note: w.openPoints ? `${w.openPoints} pts` : undefined }))} unit="open tasks" />
          ) : (
            <p className="muted small">No assigned tasks.</p>
          )}
        </section>
        <section className="tile">
          <h2>Active sprint</h2>
          {data.activeSprint ? (
            <div className="sprint-summary">
              <strong>{data.activeSprint.name}</strong>
              <p className="small">
                {formatDate(data.activeSprint.startDate)} → {formatDate(data.activeSprint.endDate)}
              </p>
              <ProgressBar value={data.activeSprint.done} max={data.activeSprint.total} />
              <p className="small muted">
                {data.activeSprint.done}/{data.activeSprint.total} tasks · {data.activeSprint.donePoints}/{data.activeSprint.points} points
              </p>
            </div>
          ) : (
            <p className="muted small">No active sprint.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="stat-card">
      <span className="stat-label">{label}</span>
      <span className="stat-value">
        {value}
        {sub && <span className="stat-sub"> {sub}</span>}
      </span>
    </div>
  );
}

/** Horizontal magnitude bars: one hue, value labelled at the bar end, tooltip on hover. */
function BarList({ rows, unit }: { rows: { label: string; value: number; note?: string }[]; unit: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="bar-list" role="table" aria-label="Bar chart">
      {rows.map((r) => (
        <div key={r.label} className="bar-row" role="row" title={`${r.label}: ${r.value} ${unit}${r.note ? ` · ${r.note}` : ''}`}>
          <span className="bar-label" role="rowheader">
            {r.label}
          </span>
          <span className="bar-track" role="cell">
            <span className="bar-fill" style={{ width: `${(r.value / max) * 100}%` }} />
            <span className="bar-value">
              {r.value}
              {r.note && <span className="muted"> · {r.note}</span>}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

/** Two-series line chart with crosshair tooltip, legend, end labels and a table view. */
function TrendChart({ trend }: { trend: ProjectReport['trend'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setW(Math.max(280, Math.floor(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [asTable]);
  const H = 220;
  const pad = { l: 28, r: 84, t: 12, b: 24 };
  const max = Math.max(1, ...trend.flatMap((d) => [d.created, d.completed]));
  const niceMax = Math.ceil(max / 2) * 2;
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / (trend.length - 1);
  const y = (v: number) => pad.t + (1 - v / niceMax) * (H - pad.t - pad.b);
  const path = (k: 'created' | 'completed') => trend.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join('');
  const last = trend[trend.length - 1];
  const series = [
    { key: 'created' as const, label: 'Created', cls: 'series-1' },
    { key: 'completed' as const, label: 'Completed', cls: 'series-2' },
  ];

  return (
    <div>
      <div className="chart-legend">
        {series.map((s) => (
          <span key={s.key} className="legend-item">
            <span className={`legend-swatch ${s.cls}`} /> {s.label}
          </span>
        ))}
        <button className="btn btn-ghost btn-sm ml-auto" onClick={() => setAsTable(!asTable)}>
          {asTable ? 'Show chart' : 'Show table'}
        </button>
      </div>
      {asTable ? (
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Created</th>
              <th>Completed</th>
            </tr>
          </thead>
          <tbody>
            {trend.map((d) => (
              <tr key={d.date}>
                <td>{formatDate(d.date)}</td>
                <td>{d.created}</td>
                <td>{d.completed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="chart-wrap" ref={wrap}>
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="trend-chart" role="img" aria-label="Tasks created and completed per day over the last 14 days" onMouseLeave={() => setHover(null)}>
            {[0, niceMax / 2, niceMax].map((v) => (
              <g key={v}>
                <line className="grid" x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} />
                <text className="axis" x={pad.l - 6} y={y(v) + 4} textAnchor="end">
                  {v}
                </text>
              </g>
            ))}
            {trend.map((d, i) =>
              (i % 3 === 0 && i < trend.length - 2) || i === trend.length - 1 ? (
                <text key={d.date} className="axis" x={x(i)} y={H - 6} textAnchor="middle">
                  {formatDate(d.date)}
                </text>
              ) : null,
            )}
            {hover !== null && <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} />}
            {series.map((s) => (
              <g key={s.key}>
                <path className={`line ${s.cls}`} d={path(s.key)} />
                <text className="end-label" x={x(trend.length - 1) + 8} y={y(last[s.key]) + (s.key === 'created' && last.created === last.completed ? -6 : 4)}>
                  {s.label} {last[s.key]}
                </text>
                {hover !== null && <circle className={`dot ${s.cls}`} cx={x(hover)} cy={y(trend[hover][s.key])} r={4} />}
              </g>
            ))}
            {trend.map((d, i) => (
              <rect key={d.date} x={x(i) - (W - pad.l - pad.r) / (trend.length - 1) / 2} y={pad.t} width={(W - pad.l - pad.r) / (trend.length - 1)} height={H - pad.t - pad.b} fill="transparent" onMouseEnter={() => setHover(i)} />
            ))}
          </svg>
          {hover !== null && (
            <div className="chart-tooltip" style={{ left: `${(x(hover) / W) * 100}%` }}>
              <strong>{formatDate(trend[hover].date, { weekday: 'short', month: 'short', day: 'numeric' })}</strong>
              {series.map((s) => (
                <span key={s.key}>
                  <span className={`legend-swatch ${s.cls}`} /> {s.label}: {trend[hover][s.key]}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Organization-level reports hub: pick a project. */
export function ReportsHub() {
  const { data, isLoading } = useProjects();
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <span className="eyebrow">Analytics per project</span>
          <h1 className="display-sm">Reports</h1>
        </div>
      </header>
      <div className="tile list-tile">
        {isLoading ? (
          <SkeletonRows rows={4} />
        ) : (
          data?.map((p) => (
            <Link key={p.id} className="task-row" to={`/projects/${p.key}/reports`}>
              <span className="project-dot" style={{ background: p.color }} />
              <span className="task-title">{p.name}</span>
              <span className="muted small">
                {p.taskCount - p.openTaskCount}/{p.taskCount} done
              </span>
              <span style={{ width: 160 }}>
                <ProgressBar value={p.taskCount - p.openTaskCount} max={p.taskCount} />
              </span>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
