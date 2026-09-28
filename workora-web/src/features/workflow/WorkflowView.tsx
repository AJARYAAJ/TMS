import { closestCenter, DndContext, DragEndEvent, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowRight, GripVertical, Plus, Trash2, Workflow as WorkflowIcon } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { SkeletonRows } from '@/components/ui';
import { useCan } from '@/features/auth/session.store';
import { useProjectContext } from '@/features/projects/ProjectLayout';
import { useWorkflow, useWorkflowMutations } from '@/features/tasks/api';
import { TASK_STATUSES, TaskStatus, WorkflowState } from '@/types';
import { STATUS_LABEL } from '@/utils/format';

const PALETTE = ['#9a968b', '#64748b', '#0ea5e9', '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#f59e0b', '#f97316', '#14b8a6', '#16a34a', '#84cc16'];

/**
 * Workflow editor: the project's board columns. Each state maps to a status category, which
 * keeps reports, sprints, "done" detection and automations meaningful whatever the names are.
 */
export default function WorkflowView() {
  const project = useProjectContext();
  const { data: states, isLoading } = useWorkflow(project.id);
  const m = useWorkflowMutations(project.id);
  const isAdmin = useCan('ADMIN');
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const [name, setName] = useState('');
  const [category, setCategory] = useState<TaskStatus>('IN_PROGRESS');

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!states || !over || active.id === over.id) return;
    const from = states.findIndex((s) => s.id === active.id);
    const to = states.findIndex((s) => s.id === over.id);
    m.reorder.mutate(arrayMove(states, from, to).map((s) => s.id));
  };
  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    // Insert before the first "done" state so new columns land where work actually flows.
    const doneIndex = states?.findIndex((s) => s.category === 'DONE') ?? -1;
    m.create.mutate({ name: name.trim(), category, ...(doneIndex >= 0 && category !== 'DONE' ? { position: doneIndex } : {}) }, { onSuccess: () => setName('') });
  };

  if (isLoading || !states) return <div className="page"><SkeletonRows rows={5} /></div>;

  return (
    <div className="page">
      <section className="tile tile-ink workflow-flow" aria-label="Workflow overview">
        <WorkflowIcon size={20} />
        <div className="flow-chips">
          {states.map((s, i) => (
            <span key={s.id} className="flow-step">
              <span className="flow-chip" style={{ ['--st' as any]: s.color }}>
                <span className="status-dot" /> {s.name}
                {s.wipLimit ? <small>≤{s.wipLimit}</small> : null}
              </span>
              {i < states.length - 1 && <ArrowRight size={14} className="flow-arrow" />}
            </span>
          ))}
        </div>
      </section>

      <p className="muted small workflow-help">
        Drag to reorder columns. Every state belongs to a <strong>category</strong> — reports, sprints and automations use categories, so you can rename and add states freely.
        {!isAdmin && ' Only admins can change the workflow.'}
      </p>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={states.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <ol className="state-list">
            {states.map((s) => (
              <StateRow key={s.id} state={s} states={states} disabled={!isAdmin} />
            ))}
          </ol>
        </SortableContext>
      </DndContext>

      {isAdmin && (
        <form className="tile state-add" onSubmit={add}>
          <Plus size={16} />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New state, e.g. QA or Staging" aria-label="New state name" maxLength={40} />
          <select value={category} onChange={(e) => setCategory(e.target.value as TaskStatus)} aria-label="New state category">
            {TASK_STATUSES.map((c) => (
              <option key={c} value={c}>
                {STATUS_LABEL[c]}
              </option>
            ))}
          </select>
          <button className="btn btn-volt btn-sm" disabled={!name.trim() || m.create.isPending}>
            Add state
          </button>
        </form>
      )}
    </div>
  );
}

function StateRow({ state, states, disabled }: { state: WorkflowState; states: WorkflowState[]; disabled: boolean }) {
  const project = useProjectContext();
  const m = useWorkflowMutations(project.id);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: state.id, disabled });
  const [deleting, setDeleting] = useState(false);
  const [moveTo, setMoveTo] = useState('');
  const others = states.filter((s) => s.id !== state.id);
  const save = (patch: Partial<Pick<WorkflowState, 'name' | 'category' | 'color' | 'wipLimit'>>) => m.update.mutate({ id: state.id, ...patch });

  return (
    <li ref={setNodeRef} className={`tile state-row${isDragging ? ' dragging' : ''}`} style={{ transform: CSS.Transform.toString(transform), transition, ['--st' as any]: state.color }}>
      <button className="drag-handle" aria-label={`Reorder ${state.name}`} disabled={disabled} {...attributes} {...listeners}>
        <GripVertical size={16} />
      </button>
      <div className="swatch-picker" role="radiogroup" aria-label={`Color for ${state.name}`}>
        <span className="swatch-current" />
        {!disabled && (
          <div className="swatch-pop">
            {PALETTE.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={c === state.color} style={{ background: c }} onClick={() => save({ color: c })} />
            ))}
          </div>
        )}
      </div>
      <input
        className="state-name"
        defaultValue={state.name}
        key={state.name}
        disabled={disabled}
        aria-label="State name"
        maxLength={40}
        onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== state.name && save({ name: e.target.value.trim() })}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <select value={state.category} disabled={disabled} onChange={(e) => save({ category: e.target.value as TaskStatus })} aria-label={`Category for ${state.name}`}>
        {TASK_STATUSES.map((c) => (
          <option key={c} value={c}>
            {STATUS_LABEL[c]}
          </option>
        ))}
      </select>
      <label className="wip" title="Work-in-progress limit (shown on the board)">
        WIP
        <input
          type="number"
          min={1}
          max={999}
          placeholder="–"
          defaultValue={state.wipLimit ?? ''}
          key={`wip-${state.wipLimit}`}
          disabled={disabled}
          aria-label={`WIP limit for ${state.name}`}
          onBlur={(e) => {
            const v = e.target.value === '' ? null : Number(e.target.value);
            if (v !== state.wipLimit) save({ wipLimit: v });
          }}
        />
      </label>
      <span className="muted small state-count">{state.taskCount ?? 0} tasks</span>
      {!disabled && others.length > 0 && (
        deleting && (state.taskCount ?? 0) > 0 ? (
          <span className="state-delete">
            Move {state.taskCount} to
            <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} aria-label="Move tasks to">
              <option value="">choose…</option>
              {others.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <button className="btn btn-ink btn-sm" disabled={!moveTo} onClick={() => m.remove.mutate({ id: state.id, moveTo })}>
              Delete
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setDeleting(false)}>
              Cancel
            </button>
          </span>
        ) : (
          <button
            className="icon-btn danger"
            aria-label={`Delete ${state.name}`}
            onClick={() => ((state.taskCount ?? 0) > 0 ? setDeleting(true) : confirm(`Delete “${state.name}”?`) && m.remove.mutate({ id: state.id }))}
          >
            <Trash2 size={15} />
          </button>
        )
      )}
    </li>
  );
}
