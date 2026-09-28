import { Column, CreateDateColumn, Entity, JoinColumn, JoinTable, ManyToMany, ManyToOne, PrimaryGeneratedColumn, Unique, UpdateDateColumn, VersionColumn } from 'typeorm';
import { Label } from '../labels/label.entity';
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
  /** Epic or parent task (subtasks). */
  @Column({ type: 'uuid', nullable: true }) parentId: string | null;
  @Column({ type: 'int', nullable: true }) estimateMinutes: number | null;
  @Column({ type: 'timestamptz', nullable: true, select: false }) overdueNotifiedAt: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
  @VersionColumn() version: number;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' }) @JoinColumn({ name: 'assignee_id' }) assignee: User | null;
  @ManyToOne(() => User) @JoinColumn({ name: 'reporter_id' }) reporter: User;
  @ManyToOne(() => Task, { nullable: true, onDelete: 'SET NULL' }) @JoinColumn({ name: 'parent_id' }) parent: Task | null;
  @ManyToMany(() => Label)
  @JoinTable({ name: 'task_labels', joinColumn: { name: 'task_id' }, inverseJoinColumn: { name: 'label_id' } })
  labels: Label[];
  @ManyToMany(() => User)
  @JoinTable({ name: 'task_watchers', joinColumn: { name: 'task_id' }, inverseJoinColumn: { name: 'user_id' } })
  watchers: User[];
}
