import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { EmptyState, Skeleton } from '@/components/ui';
import { useSprints } from '@/features/sprints/api';
import { api } from '@/services/api/client';
import { qk } from '@/services/api/keys';
import type { Burndown, Velocity } from '@/types';
import { formatDate } from '@/utils/format';

/** Measures a container that may mount later (after a skeleton): a callback ref re-attaches the observer. */
function useWidth(min = 280) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(min, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, min]);
  return [setEl, w] as const;
}

const niceCeil = (v: number) => {
  if (v <= 5) return Math.max(1, Math.ceil(v));
  const step = Math.pow(10, Math.floor(Math.log10(v))) / 2;
  return Math.ceil(v / step) * step;
};

/**
 * Sprint burndown: remaining work (series-1, solid) against the ideal line (neutral, dashed reference).
 * Crosshair + tooltip on hover, legend, end label, and a table view.
 */
export function BurndownTile({ projectId }: { projectId: string }) {
  const { data: sprints } = useSprints(projectId);
  const candidates = (sprints ?? []).filter((s) => s.status !== 'PLANNED');
  const initial = candidates.find((s) => s.status === 'ACTIVE') ?? [...candidates].reverse().find((s) => s.status === 'COMPLETED');
  const [picked, setPicked] = useState<string | null>(null);
  const sprintId = picked ?? initial?.id ?? null;
  const { data, isLoading } = useQuery({ queryKey: qk.burndown(sprintId ?? ''), queryFn: () => api.get<Burndown>(`/sprints/${sprintId}/burndown`), enabled: !!sprintId });
  const [asTable, setAsTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [wrap, W] = useWidth();

  if (!sprints) return <Skeleton height={220} />;
  if (!candidates.length) return <EmptyState title="No sprint started yet">Start a sprint from the Backlog to see its burndown.</EmptyState>;

  const H = 230;
  const pad = { l: 34, r: 96, t: 14, b: 26 };
  const days = data?.days ?? [];
  const max = niceCeil(Math.max(1, data?.total ?? 1));
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / Math.max(days.length - 1, 1);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const actual = days.map((d, i) => ({ d, i })).filter(({ d }) => d.remaining !== null);
  const lastActual = actual[actual.length - 1];
  const unit = data?.unit === 'points' ? 'pts' : 'tasks';
  const step = Math.max(1, Math.ceil(days.length / 7));

  return (
    <div>
      <div className="chart-legend">
        <select className="chart-select" value={sprintId ?? ''} onChange={(e) => setPicked(e.target.value)} aria-label="Sprint">
          {candidates.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} {s.status === 'ACTIVE' ? '· active' : ''}
            </option>
          ))}
        </select>
        <span className="legend-item">
          <span className="legend-swatch series-1" /> Remaining
        </span>
        <span className="legend-item">
          <span className="legend-swatch ref-dash" /> Ideal
        </span>
        <button className="btn btn-ghost btn-sm ml-auto" onClick={() => setAsTable(!asTable)}>
          {asTable ? 'Show chart' : 'Show table'}
        </button>
      </div>
      {isLoading || !data ? (
        <Skeleton height={H} />
      ) : asTable ? (
        <table className="data-table">
          <thead>
            <tr>
              <th>Day</th>
              <th>Remaining ({unit})</th>
              <th>Ideal</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.date}>
                <td>{formatDate(d.date)}</td>
                <td>{d.remaining ?? '—'}</td>
                <td>{d.ideal}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="chart-wrap" ref={wrap}>
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="trend-chart" role="img" aria-label={`Burndown for ${data.name}: ${lastActual?.d.remaining ?? data.total} of ${data.total} ${unit} remaining`} onMouseLeave={() => setHover(null)}>
            {[0, max / 2, max].map((v) => (
              <g key={v}>
                <line className="grid" x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} />
                <text className="axis" x={pad.l - 6} y={y(v) + 4} textAnchor="end">
                  {Math.round(v)}
                </text>
              </g>
            ))}
            {days.map((d, i) =>
              i % step === 0 || i === days.length - 1 ? (
                <text key={d.date} className="axis" x={x(i)} y={H - 7} textAnchor="middle">
                  {formatDate(d.date)}
                </text>
              ) : null,
            )}
            <path className="line ref-line" d={days.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.ideal).toFixed(1)}`).join('')} />
            {hover !== null && <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} />}
            {actual.length > 0 && <path className="line series-1" d={actual.map(({ d, i }, k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.remaining!).toFixed(1)}`).join('')} />}
            {lastActual && (
              <>
                <circle className="dot series-1" cx={x(lastActual.i)} cy={y(lastActual.d.remaining!)} r={4} />
                <text className="end-label" x={Math.min(x(lastActual.i) + 8, W - pad.r + 8)} y={y(lastActual.d.remaining!) - 8}>
                  {lastActual.d.remaining} {unit} left
                </text>
              </>
            )}
            {hover !== null && days[hover].remaining !== null && <circle className="dot series-1" cx={x(hover)} cy={y(days[hover].remaining!)} r={4} />}
            {days.map((d, i) => (
              <rect key={d.date} x={x(i) - (W - pad.l - pad.r) / Math.max(days.length - 1, 1) / 2} y={pad.t} width={(W - pad.l - pad.r) / Math.max(days.length - 1, 1)} height={H - pad.t - pad.b} fill="transparent" onMouseEnter={() => setHover(i)} />
            ))}
          </svg>
          {hover !== null && (
            <div className="chart-tooltip" style={{ left: `${(x(hover) / W) * 100}%` }}>
              <strong>{formatDate(days[hover].date, { weekday: 'short', month: 'short', day: 'numeric' })}</strong>
              <span>
                <span className="legend-swatch series-1" /> Remaining: {days[hover].remaining ?? '—'} {unit}
              </span>
              <span>
                <span className="legend-swatch ref-dash" /> Ideal: {days[hover].ideal}
              </span>
            </div>
          )}
        </div>
      )}
      {data && (
        <p className="muted small chart-note">
          {formatDate(data.startDate)} → {formatDate(data.endDate)} · scope {data.total} {unit}
          {data.status === 'COMPLETED' ? ' · completed sprint' : ''}
        </p>
      )}
    </div>
  );
}

/** Velocity: committed (series-2) vs completed (series-1) per completed sprint; grouped bars, 2px gap. */
export function VelocityTile({ projectId }: { projectId: string }) {
  const { data } = useQuery({ queryKey: qk.velocity(projectId), queryFn: () => api.get<Velocity>(`/projects/${projectId}/velocity`) });
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const [wrap, W] = useWidth();
  if (!data) return <Skeleton height={200} />;
  if (!data.sprints.length) return <EmptyState title="No completed sprints yet">Velocity appears after your first sprint is completed.</EmptyState>;
  const H = 210;
  const pad = { l: 34, r: 12, t: 18, b: 28 };
  const max = niceCeil(Math.max(1, ...data.sprints.flatMap((s) => [s.committed, s.completed])));
  const band = (W - pad.l - pad.r) / data.sprints.length;
  const bw = Math.min(26, (band - 18) / 2);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const unit = data.unit === 'points' ? 'pts' : 'tasks';
  const bar = (x0: number, v: number, cls: string) => {
    const top = y(v);
    const h = H - pad.b - top;
    if (h <= 0) return null;
    const r = Math.min(4, h);
    // Rounded data-end, square baseline.
    return <path className={`bar ${cls}`} d={`M${x0},${H - pad.b}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + bw - r}Q${x0 + bw},${top} ${x0 + bw},${top + r}V${H - pad.b}Z`} />;
  };
  return (
    <div>
      <div className="chart-legend">
        <span className="legend-item">
          <span className="legend-swatch series-2" /> Committed
        </span>
        <span className="legend-item">
          <span className="legend-swatch series-1" /> Completed
        </span>
        <span className="muted small">
          avg (last 3): <strong>{data.average}</strong> {unit}
        </span>
        <button className="btn btn-ghost btn-sm ml-auto" onClick={() => setAsTable(!asTable)}>
          {asTable ? 'Show chart' : 'Show table'}
        </button>
      </div>
      {asTable ? (
        <table className="data-table">
          <thead>
            <tr>
              <th>Sprint</th>
              <th>Committed ({unit})</th>
              <th>Completed</th>
            </tr>
          </thead>
          <tbody>
            {data.sprints.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{s.committed}</td>
                <td>{s.completed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="chart-wrap" ref={wrap}>
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="trend-chart" role="img" aria-label={`Velocity over ${data.sprints.length} sprints, average ${data.average} ${unit}`} onMouseLeave={() => setHover(null)}>
            {[0, max / 2, max].map((v) => (
              <g key={v}>
                <line className="grid" x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} />
                <text className="axis" x={pad.l - 6} y={y(v) + 4} textAnchor="end">
                  {Math.round(v)}
                </text>
              </g>
            ))}
            {data.sprints.map((s, i) => {
              const cx = pad.l + band * i + band / 2;
              return (
                <g key={s.id} className={hover === i ? 'hovered' : ''}>
                  {bar(cx - bw - 1, s.committed, 'series-2')}
                  {bar(cx + 1, s.completed, 'series-1')}
                  <text className="axis" x={cx} y={H - 9} textAnchor="middle">
                    {s.name.length > 12 ? `${s.name.slice(0, 11)}…` : s.name}
                  </text>
                  {i === data.sprints.length - 1 && (
                    <text className="end-label" x={cx + 1 + bw / 2} y={y(s.completed) - 6} textAnchor="middle">
                      {s.completed}
                    </text>
                  )}
                  <rect x={pad.l + band * i} y={pad.t} width={band} height={H - pad.t - pad.b} fill="transparent" onMouseEnter={() => setHover(i)} />
                </g>
              );
            })}
          </svg>
          {hover !== null && (
            <div className="chart-tooltip" style={{ left: `${((pad.l + band * hover + band / 2) / W) * 100}%` }}>
              <strong>{data.sprints[hover].name}</strong>
              <span>
                <span className="legend-swatch series-2" /> Committed: {data.sprints[hover].committed} {unit}
              </span>
              <span>
                <span className="legend-swatch series-1" /> Completed: {data.sprints[hover].completed} {unit}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
