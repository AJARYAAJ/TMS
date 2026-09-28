import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type { TaskStatus } from '../tasks/task.entity';

/**
 * A column in a project's workflow ("QA", "Staging"…). Every state belongs to one of the four
 * status categories, which is what reports, sprints and automations reason about.
 */
@Entity('workflow_states')
export class WorkflowState {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') organizationId: string;
  @Column('uuid') projectId: string;
  @Column() name: string;
  @Column({ type: 'varchar' }) category: TaskStatus;
  @Column() color: string;
  @Column({ type: 'int', default: 0 }) position: number;
  /** Soft work-in-progress limit shown on the board. */
  @Column({ type: 'int', nullable: true }) wipLimit: number | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

export const DEFAULT_STATES: { name: string; category: TaskStatus; color: string }[] = [
  // String literals (not the enum) so this module can load inside the entity import cycle.
  { name: 'To do', category: 'TODO' as TaskStatus, color: '#9a968b' },
  { name: 'In progress', category: 'IN_PROGRESS' as TaskStatus, color: '#3b82f6' },
  { name: 'In review', category: 'IN_REVIEW' as TaskStatus, color: '#a855f7' },
  { name: 'Done', category: 'DONE' as TaskStatus, color: '#16a34a' },
];

export const toStateDto = (s: WorkflowState) => ({ id: s.id, name: s.name, category: s.category, color: s.color, position: s.position, wipLimit: s.wipLimit });
export type StateDto = ReturnType<typeof toStateDto>;
