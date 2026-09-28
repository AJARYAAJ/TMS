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
import { Plus } from 'lucide-react';
import { useRef, useState } from 'react';
import { useUiStore } from '@/app/ui.store';
import { Avatar, PriorityIcon, Skeleton, TypeIcon } from '@/components/ui';
import { useCan } from '@/features/auth/session.store';
import { useBoard, useMoveTask } from '@/features/tasks/api';
import { useOpenTask } from '@/features/tasks/useOpenTask';
import { qk } from '@/services/api/keys';
import type { Board, Task, TaskStatus } from '@/types';
import { formatDate, isOverdue, STATUS_LABEL } from '@/utils/format';

const colId = (s: TaskStatus) => `col:${s}`;

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
    if (id.startsWith('col:')) return id.slice(4) as TaskStatus;
    return b.columns.find((c) => c.tasks.some((t) => t.id === id))?.status;
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
      const task = b.columns.find((c) => c.status === from)!.tasks.find((t) => t.id === active.id)!;
      return {
        ...b,
        columns: b.columns.map((c) => {
          if (c.status === from) return { ...c, tasks: c.tasks.filter((t) => t.id !== active.id) };
          if (c.status !== to) return c;
          const overIndex = c.tasks.findIndex((t) => t.id === over.id);
          const tasks = [...c.tasks];
          tasks.splice(overIndex >= 0 ? overIndex : tasks.length, 0, { ...task, status: to });
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
      const status = columnOf(b, String(active.id));
      if (!status) return b;
      final = {
        ...b,
        columns: b.columns.map((c) => {
          if (c.status !== status) return c;
          const from = c.tasks.findIndex((t) => t.id === active.id);
          const to = over.id === colId(status) ? c.tasks.length - 1 : c.tasks.findIndex((t) => t.id === over.id);
          return { ...c, tasks: to >= 0 && from !== to ? arrayMove(c.tasks, from, to) : c.tasks };
        }),
      };
      return final;
    });
    if (!final) return;

    const original = before.columns.flatMap((c) => c.tasks).find((t) => t.id === active.id)!;
    const column = final.columns.find((c) => c.tasks.some((t) => t.id === active.id))!;
    const index = column.tasks.findIndex((t) => t.id === active.id);
    const position = serverPosition(column.tasks, index, original, column.status);
    if (column.status === original.status && position === original.position) return;

    const rollbackTo = before;
    move.mutate({ task: original, status: column.status, position, rollback: () => qc.setQueryData(queryKey, rollbackTo) });
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
          <Column key={col.status} projectId={projectId} sprintId={sprintId} status={col.status} tasks={col.tasks} canEdit={canEdit} />
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
function serverPosition(tasks: Task[], index: number, original: Task, status: TaskStatus) {
  const sameColumn = original.status === status;
  const adjust = (neighbourPos: number) => (sameColumn && original.position < neighbourPos ? -1 : 0);
  const next = tasks[index + 1];
  if (next) return next.position + adjust(next.position);
  const prev = tasks[index - 1];
  if (prev) return prev.position + 1 + adjust(prev.position);
  return 0;
}

function Column({ projectId, sprintId, status, tasks, canEdit }: { projectId: string; sprintId?: string; status: TaskStatus; tasks: Task[]; canEdit: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: colId(status), data: { type: 'column' } });
  const openCreateTask = useUiStore((s) => s.openCreateTask);
  return (
    <section className={`board-column${isOver ? ' over' : ''}`} aria-label={STATUS_LABEL[status]}>
      <header className="board-column-header">
        <span className={`status-dot status-${status.toLowerCase()}`} />
        {STATUS_LABEL[status]}
        <span className="count">{tasks.length}</span>
        {canEdit && (
          <button className="icon-btn ml-auto" title={`Add task to ${STATUS_LABEL[status]}`} onClick={() => openCreateTask({ projectId, status, sprintId })}>
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
  return (
    <article className={`task-card${overlay ? ' overlay' : ''}`} onClick={() => !overlay && openTask(task.key)} onKeyDown={(e) => e.key === 'Enter' && openTask(task.key)}>
      <p className="task-card-title">{task.title}</p>
      <div className="task-card-meta">
        <TypeIcon type={task.type} />
        <span className="task-key">{task.key}</span>
        <PriorityIcon priority={task.priority} />
        {task.storyPoints != null && <span className="points">{task.storyPoints}</span>}
        {task.dueDate && <span className={`due${isOverdue(task.dueDate, task.status) ? ' overdue' : ''}`}>{formatDate(task.dueDate)}</span>}
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
