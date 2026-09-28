import { AlertOctagon } from 'lucide-react';
import { Avatar, LabelChip, PriorityIcon, StatusBadge, TypeIcon } from '@/components/ui';
import type { Task } from '@/types';
import { formatDate, isOverdue } from '@/utils/format';
import { useOpenTask } from './useOpenTask';

export function TaskRow({ task, extra, selected, onSelect }: { task: Task; extra?: React.ReactNode; selected?: boolean; onSelect?: (on: boolean, shift: boolean) => void }) {
  const openTask = useOpenTask();
  return (
    <div
      className={`task-row${selected ? ' selected' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => openTask(task.key)}
      onKeyDown={(e) => e.key === 'Enter' && openTask(task.key)}
    >
      {onSelect && (
        <input
          type="checkbox"
          className="row-check"
          checked={!!selected}
          aria-label={`Select ${task.key}`}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(!selected, e.shiftKey);
          }}
          onChange={() => {}}
        />
      )}
      <TypeIcon type={task.type} />
      <span className="task-key">{task.key}</span>
      <span className="task-title ellipsis">
        {task.title}
        {task.subtaskCount > 0 && (
          <span className="muted small">
            {' '}
            · {task.subtaskDone}/{task.subtaskCount}
          </span>
        )}
      </span>
      {task.blockedBy > 0 && <AlertOctagon size={14} className="text-danger" aria-label="Blocked" />}
      <span className="row-labels">
        {task.labels.slice(0, 2).map((l) => (
          <LabelChip key={l.id} label={l} />
        ))}
      </span>
      {extra}
      <PriorityIcon priority={task.priority} />
      <StatusBadge status={task.status} state={task.state} />
      <span className={`due${isOverdue(task.dueDate, task.status) ? ' overdue' : ''}`}>{formatDate(task.dueDate)}</span>
      <Avatar user={task.assignee} size={22} />
    </div>
  );
}
