import {
  closestCorners,
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQueryClient } from '@tanstack/react-query';
import { AlertOctagon, CheckSquare, Clock, GitPullRequest, MessageSquare, Plus, Repeat } from 'lucide-react';
import { useRef, useState } from 'react';
import { useUiStore } from '@/app/ui.store';
import { Avatar, formatMinutes, LabelChip, PriorityIcon, Skeleton, TypeIcon } from '@/components/ui';
import { useCan } from '@/features/auth/session.store';
import { useBoard, useMoveTask } from '@/features/tasks/api';
import { useOpenTask } from '@/features/tasks/useOpenTask';
import { qk } from '@/services/api/keys';
import type { Board, Task, WorkflowState } from '@/types';
import { formatDate, isOverdue, STATUS_LABEL } from '@/utils/format';

const colId = (stateId: string) => `col:${stateId}`;

/**
 * Kanban board. Dragging updates the cached board immediately (optimistic UI); the
 * PATCH /tasks/:id/status call confirms it, and a failure restores the pre-drag snapshot.
 */
export function BoardView({ projectId, sprintId, emptyHint }: { projectId: string; sprintId?: string; emptyHint?: string }) {
  const qc = useQueryClient();
  const queryKey = [...qk.board(projectId), sprintId ?? 'all'];
  const { data: board, isLoading } = useBoard(projectId, sprintId);
  const move = useMoveTask();
  const canEdit = useCan('MEMBER');
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const snapshot = useRef<Board | undefined>(undefined);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  if (isLoading || !board) return <BoardSkeleton />;

  const columnOf = (b: Board, id: string) => {
    if (id.startsWith('col:')) return id.slice(4);
    return b.columns.find((c) => c.tasks.some((t) => t.id === id))?.state.id;
  };
  const setBoard = (fn: (b: Board) => Board) => qc.setQueryData<Board>(queryKey, (b) => (b ? fn(b) : b));

  const onDragStart = ({ active }: DragStartEvent) => {
    qc.cancelQueries({ queryKey: qk.board(projectId) });
    snapshot.current = board;
    setActiveTask(board.columns.flatMap((c) => c.tasks).find((t) => t.id === active.id) ?? null);
  };

  // Live preview when crossing into another column.
  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    setBoard((b) => {
      const from = columnOf(b, String(active.id));
      const to = columnOf(b, String(over.id));
      if (!from || !to || from === to) return b;
      const task = b.columns.find((c) => c.state.id === from)!.tasks.find((t) => t.id === active.id)!;
      return {
        ...b,
        columns: b.columns.map((c) => {
          if (c.state.id === from) return { ...c, tasks: c.tasks.filter((t) => t.id !== active.id) };
          if (c.state.id !== to) return c;
          const overIndex = c.tasks.findIndex((t) => t.id === over.id);
          const tasks = [...c.tasks];
          tasks.splice(overIndex >= 0 ? overIndex : tasks.length, 0, { ...task, stateId: c.state.id, state: c.state, status: c.state.category });
          return { ...c, tasks };
        }),
      };
    });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveTask(null);
    const before = snapshot.current;
    if (!over || !before) return;
    let final: Board | undefined;
    setBoard((b) => {
      const stateId = columnOf(b, String(active.id));
      if (!stateId) return b;
      final = {
        ...b,
        columns: b.columns.map((c) => {
          if (c.state.id !== stateId) return c;
          const from = c.tasks.findIndex((t) => t.id === active.id);
          const to = over.id === colId(stateId) ? c.tasks.length - 1 : c.tasks.findIndex((t) => t.id === over.id);
          return { ...c, tasks: to >= 0 && from !== to ? arrayMove(c.tasks, from, to) : c.tasks };
        }),
      };
      return final;
    });
    if (!final) return;

    const original = before.columns.flatMap((c) => c.tasks).find((t) => t.id === active.id)!;
    const column = final.columns.find((c) => c.tasks.some((t) => t.id === active.id))!;
    const index = column.tasks.findIndex((t) => t.id === active.id);
    const position = serverPosition(column.tasks, index, original, column.state.id);
    if (column.state.id === original.stateId && position === original.position) return;

    const rollbackTo = before;
    move.mutate({ task: original, stateId: column.state.id, position, rollback: () => qc.setQueryData(queryKey, rollbackTo) });
  };

  const onDragCancel = () => {
    setActiveTask(null);
    if (snapshot.current) qc.setQueryData(queryKey, snapshot.current);
  };

  const total = board.columns.reduce((n, c) => n + c.tasks.length, 0);

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={onDragCancel}>
      {total === 0 && emptyHint && <p className="muted small board-hint">{emptyHint}</p>}
      <div className="board">
        {board.columns.map((col) => (
          <Column key={col.state.id} projectId={projectId} sprintId={sprintId} state={col.state} tasks={col.tasks} canEdit={canEdit} />
        ))}
      </div>
      <DragOverlay>{activeTask ? <Card task={activeTask} overlay /> : null}</DragOverlay>
    </DndContext>
  );
}

/**
 * Converts an index in the (possibly sprint-filtered) column into the server's position
 * within the full column, using the neighbouring cards' server positions.
 */
function serverPosition(tasks: Task[], index: number, original: Task, stateId: string) {
  const sameColumn = original.stateId === stateId;
  const adjust = (neighbourPos: number) => (sameColumn && original.position < neighbourPos ? -1 : 0);
  const next = tasks[index + 1];
  if (next) return next.position + adjust(next.position);
  const prev = tasks[index - 1];
  if (prev) return prev.position + 1 + adjust(prev.position);
  return 0;
}

function Column({ projectId, sprintId, state, tasks, canEdit }: { projectId: string; sprintId?: string; state: WorkflowState; tasks: Task[]; canEdit: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: colId(state.id), data: { type: 'column' } });
  const openCreateTask = useUiStore((s) => s.openCreateTask);
  const overLimit = state.wipLimit !== null && tasks.length > state.wipLimit;
  return (
    <section className={`board-column${isOver ? ' over' : ''}${overLimit ? ' over-limit' : ''}`} aria-label={state.name} style={{ ['--st' as any]: state.color }}>
      <header className="board-column-header" title={`${state.name} · ${STATUS_LABEL[state.category]} category${state.wipLimit ? ` · WIP limit ${state.wipLimit}` : ''}`}>
        <span className="status-dot" />
        <span className="ellipsis">{state.name}</span>
        <span className={`count${overLimit ? ' count-danger' : ''}`} title={state.wipLimit ? `WIP limit ${state.wipLimit}` : undefined}>
          {tasks.length}
          {state.wipLimit ? ` / ${state.wipLimit}` : ''}
        </span>
        {canEdit && (
          <button className="icon-btn ml-auto" title={`Add task to ${state.name}`} onClick={() => openCreateTask({ projectId, status: state.category, stateId: state.id, sprintId })}>
            <Plus size={14} />
          </button>
        )}
      </header>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="board-cards" ref={setNodeRef}>
          {tasks.map((t) => (
            <SortableCard key={t.id} task={t} disabled={!canEdit} />
          ))}
        </div>
      </SortableContext>
    </section>
  );
}

function SortableCard({ task, disabled }: { task: Task; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, disabled });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={isDragging ? 'dragging' : ''} {...attributes} {...listeners}>
      <Card task={task} />
    </div>
  );
}

function Card({ task, overlay }: { task: Task; overlay?: boolean }) {
  const openTask = useOpenTask();
  const overdue = isOverdue(task.dueDate, task.status);
  return (
    <article
      className={`task-card status-${task.status.toLowerCase()} prio-${task.priority.toLowerCase()}${overlay ? ' overlay' : ''}${task.blockedBy ? ' blocked' : ''}`}
      style={task.state ? { ['--st' as any]: task.state.color } : undefined}
      onClick={() => !overlay && openTask(task.key)}
      onKeyDown={(e) => e.key === 'Enter' && openTask(task.key)}
    >
      <div className="card-top">
        <TypeIcon type={task.type} />
        <span className="mono">{task.key}</span>
        {task.parent && <span className="card-epic ellipsis" title={task.parent.title}>{task.parent.title}</span>}
        {task.recurrence && <Repeat size={12} className="card-repeat" aria-label="Recurring task" />}
        <span className="ml-auto">
          <PriorityIcon priority={task.priority} />
        </span>
      </div>
      <p className="task-card-title">{task.title}</p>
      {task.labels.length > 0 && (
        <div className="card-labels">
          {task.labels.slice(0, 3).map((l) => (
            <LabelChip key={l.id} label={l} />
          ))}
        </div>
      )}
      <div className="task-card-meta">
        {task.blockedBy > 0 && (
          <span className="meta-blocked" title={`Blocked by ${task.blockedBy} task(s)`}>
            <AlertOctagon size={12} /> blocked
          </span>
        )}
        {task.subtaskCount > 0 && (
          <span title="Subtasks done">
            <CheckSquare size={12} /> {task.subtaskDone}/{task.subtaskCount}
          </span>
        )}
        {task.openPrs > 0 && (
          <span className="meta-pr" title={`${task.openPrs} open pull request(s)`}>
            <GitPullRequest size={12} /> {task.openPrs}
          </span>
        )}
        {task.commentCount > 0 && (
          <span title="Comments">
            <MessageSquare size={12} /> {task.commentCount}
          </span>
        )}
        {task.loggedMinutes > 0 && (
          <span title="Time logged">
            <Clock size={12} /> {formatMinutes(task.loggedMinutes)}
          </span>
        )}
        {task.storyPoints != null && <span className="points">{task.storyPoints}</span>}
        {task.dueDate && <span className={`due${overdue ? ' overdue' : ''}`}>{formatDate(task.dueDate)}</span>}
        <span className="ml-auto">
          <Avatar user={task.assignee} size={22} />
        </span>
      </div>
    </article>
  );
}

function BoardSkeleton() {
  return (
    <div className="board" aria-busy="true">
      {[3, 2, 1, 2].map((n, i) => (
        <section key={i} className="board-column">
          <header className="board-column-header">
            <Skeleton width={90} />
          </header>
          <div className="board-cards">
            {Array.from({ length: n }, (_, j) => (
              <div key={j} className="task-card">
                <Skeleton width="85%" />
                <Skeleton width="50%" style={{ marginTop: 10 }} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
