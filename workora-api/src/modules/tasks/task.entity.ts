import { Column, CreateDateColumn, Entity, JoinColumn, JoinTable, ManyToMany, ManyToOne, PrimaryGeneratedColumn, Unique, UpdateDateColumn, VersionColumn } from 'typeorm';
import { Label } from '../labels/label.entity';
import type { RecurrenceRule } from '../recurrence/recurrence';
import { WorkflowState } from '../workflow/workflow-state.entity';
import { User } from '../users/user.entity';

export enum TaskStatus {
  TODO = 'TODO',
  IN_PROGRESS = 'IN_PROGRESS',
  IN_REVIEW = 'IN_REVIEW',
  DONE = 'DONE',
}
export const TASK_STATUSES = Object.values(TaskStatus);

export enum TaskPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

/** Tasks and issues share one model; `type` distinguishes them. */
export enum TaskType {
  TASK = 'TASK',
  BUG = 'BUG',
  STORY = 'STORY',
  EPIC = 'EPIC',
}

@Entity('tasks')
@Unique(['organizationId', 'key'])
export class Task {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') organizationId: string;
  @Column('uuid') projectId: string;
  @Column('int') number: number;
  /** Human-readable identifier such as ECOM-102. */
  @Column() key: string;
  @Column() title: string;
  @Column({ type: 'text', default: '' }) description: string;
  @Column({ type: 'varchar', default: TaskType.TASK }) type: TaskType;
  @Column({ type: 'varchar', default: TaskStatus.TODO }) status: TaskStatus;
  @Column({ type: 'varchar', default: TaskPriority.MEDIUM }) priority: TaskPriority;
  /** Zero-based order within the status column on the board. */
  @Column({ type: 'int', default: 0 }) position: number;
  @Column({ type: 'uuid', nullable: true }) assigneeId: string | null;
  @Column('uuid') reporterId: string;
  @Column({ type: 'uuid', nullable: true }) sprintId: string | null;
  @Column({ type: 'int', nullable: true }) storyPoints: number | null;
  @Column({ type: 'date', nullable: true }) startDate: string | null;
  @Column({ type: 'date', nullable: true }) dueDate: string | null;
  @Column({ type: 'timestamptz', nullable: true }) completedAt: Date | null;
  /** Workflow column; `status` always mirrors this state's category. */
  @Column('uuid') stateId: string;
  @Column({ type: 'jsonb', nullable: true }) recurrence: RecurrenceRule | null;
  /** Shared by every occurrence of a recurring task. */
  @Column({ type: 'uuid', nullable: true }) seriesId: string | null;
  @Column({ type: 'timestamptz', nullable: true, select: false }) recurrenceSpawnedAt: Date | null;
  /** Epic or parent task (subtasks). */
  @Column({ type: 'uuid', nullable: true }) parentId: string | null;
  @Column({ type: 'int', nullable: true }) estimateMinutes: number | null;
  @Column({ type: 'timestamptz', nullable: true, select: false }) overdueNotifiedAt: Date | null;
  /** Custom field values keyed by custom field id. */
  @Column({ type: 'jsonb', default: {} }) customValues: Record<string, string | number | boolean | string[]>;
  /**
   * Set when the task is in the trash. `tasks` is a view over live rows (see migration
   * WorkManagementPlus), so this is always null here; trash code reads `tasks_all`.
   */
  @Column({ type: 'timestamptz', nullable: true, select: false }) deletedAt: Date | null;
  @Column({ type: 'uuid', nullable: true }) deletedById: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
  @VersionColumn() version: number;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' }) @JoinColumn({ name: 'assignee_id' }) assignee: User | null;
  @ManyToOne(() => User) @JoinColumn({ name: 'reporter_id' }) reporter: User;
  @ManyToOne(() => Task, { nullable: true, onDelete: 'SET NULL' }) @JoinColumn({ name: 'parent_id' }) parent: Task | null;
  @ManyToOne(() => WorkflowState) @JoinColumn({ name: 'state_id' }) state: WorkflowState;
  @ManyToMany(() => Label)
  @JoinTable({ name: 'task_labels', joinColumn: { name: 'task_id' }, inverseJoinColumn: { name: 'label_id' } })
  labels: Label[];
  @ManyToMany(() => User)
  @JoinTable({ name: 'task_watchers', joinColumn: { name: 'task_id' }, inverseJoinColumn: { name: 'user_id' } })
  watchers: User[];
}
