import { Avatar, PriorityIcon, StatusBadge, TypeIcon } from '@/components/ui';
import type { Task } from '@/types';
import { formatDate, isOverdue } from '@/utils/format';
import { useOpenTask } from './useOpenTask';

export function TaskRow({ task, extra, showProject }: { task: Task; extra?: React.ReactNode; showProject?: boolean }) {
  const openTask = useOpenTask();
  return (
    <div className="task-row" role="button" tabIndex={0} onClick={() => openTask(task.key)} onKeyDown={(e) => e.key === 'Enter' && openTask(task.key)}>
      <TypeIcon type={task.type} />
      <span className="task-key">{task.key}</span>
      <span className="task-title ellipsis">{task.title}</span>
      {showProject && <span className="muted small">{task.key.split('-')[0]}</span>}
      {extra}
      <PriorityIcon priority={task.priority} />
      <StatusBadge status={task.status} />
      <span className={`due${isOverdue(task.dueDate, task.status) ? ' overdue' : ''}`}>{formatDate(task.dueDate)}</span>
      <Avatar user={task.assignee} size={22} />
    </div>
  );
}
