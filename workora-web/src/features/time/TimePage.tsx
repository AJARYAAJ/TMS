import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Clock, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { EmptyState, formatMinutes, SkeletonRows } from '@/components/ui';
import { useSession, useCan } from '@/features/auth/session.store';
import { useUsers } from '@/features/projects/api';
import { useTimer } from '@/features/tasks/api';
import { useOpenTask } from '@/features/tasks/useOpenTask';
import { api } from '@/services/api/client';
import { qk } from '@/services/api/keys';
import type { TimeEntry } from '@/types';
import { formatDate, toIsoDate } from '@/utils/format';

interface Timesheet {
  totalMinutes: number;
  byDay: Record<string, number>;
  entries: TimeEntry[];
}

/** Weekly timesheet with a per-day bar strip; admins can view anyone's week. */
export default function TimePage() {
  const me = useSession()!.user;
  const isAdmin = useCan('ADMIN');
  const { data: users } = useUsers();
  const [userId, setUserId] = useState(me.id);
  const [week, setWeek] = useState(0);
  const monday = new Date();
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) + week * 7);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return toIsoDate(d);
  });
  const params = { userId: userId === me.id ? 'me' : userId, from: days[0], to: days[6] };
  const { data, isLoading } = useQuery({ queryKey: qk.timesheet(params), queryFn: () => api.get<Timesheet>('/time-entries', params) });
  const { remove } = useTimer();
  const openTask = useOpenTask();
  const max = Math.max(60, ...Object.values(data?.byDay ?? {}));

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <span className="eyebrow">Time tracking</span>
          <h1 className="display-sm">Timesheet</h1>
        </div>
        <div className="big-total">
          <span className="eyebrow">This week</span>
          <strong>{formatMinutes(data?.totalMinutes ?? 0)}</strong>
        </div>
      </header>
      <div className="toolbar">
        <div className="seg">
          <button onClick={() => setWeek(week - 1)} aria-label="Previous week">
            <ChevronLeft size={15} />
          </button>
          <button onClick={() => setWeek(0)}>
            {formatDate(days[0])} – {formatDate(days[6])}
          </button>
          <button onClick={() => setWeek(week + 1)} aria-label="Next week" disabled={week >= 0}>
            <ChevronRight size={15} />
          </button>
        </div>
        {isAdmin && (
          <select value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="Person">
            {users?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.id === me.id ? 'Me' : u.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <section className="tile week-strip" aria-label="Minutes per day">
        {days.map((d) => {
          const m = data?.byDay[d] ?? 0;
          return (
            <div key={d} className="week-day" title={`${formatDate(d)}: ${formatMinutes(m)}`}>
              <span className="week-bar">
                <span style={{ height: `${(m / max) * 100}%` }} />
              </span>
              <strong>{m ? formatMinutes(m) : '–'}</strong>
              <span className="muted small">{new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short' })}</span>
            </div>
          );
        })}
      </section>
      <section className="tile">
        <h2>Entries</h2>
        {isLoading ? (
          <SkeletonRows rows={4} />
        ) : !data?.entries.length ? (
          <EmptyState icon={<Clock size={28} />} title="No time logged this week">
            Start a timer from any task, or log time manually in the task sheet.
          </EmptyState>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Day</th>
                <th>Task</th>
                <th>Note</th>
                <th style={{ textAlign: 'right' }}>Time</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.id}>
                  <td className="muted">{formatDate(e.startedAt, { weekday: 'short', month: 'short', day: 'numeric' })}</td>
                  <td>
                    <button className="link-btn" onClick={() => e.task && openTask(e.task.key)}>
                      <span className="mono">{e.task?.key}</span> {e.task?.title}
                    </button>
                  </td>
                  <td className="muted">{e.note}</td>
                  <td style={{ textAlign: 'right' }}>{e.running ? <span className="pill pill-volt">running</span> : formatMinutes(e.minutes)}</td>
                  <td>
                    {!e.running && (e.user.id === me.id || isAdmin) && (
                      <button className="icon-btn danger" aria-label="Delete entry" onClick={() => remove.mutate(e.id)}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
