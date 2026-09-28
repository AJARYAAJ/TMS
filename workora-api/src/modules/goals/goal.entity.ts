import { Column, CreateDateColumn, Entity, JoinColumn, JoinTable, ManyToMany, ManyToOne, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Project } from '../projects/project.entity';
import { Task } from '../tasks/task.entity';
import { User } from '../users/user.entity';

export enum GoalStatus {
  ON_TRACK = 'ON_TRACK',
  AT_RISK = 'AT_RISK',
  OFF_TRACK = 'OFF_TRACK',
  ACHIEVED = 'ACHIEVED',
}

export enum KeyResultKind {
  /** Manually updated number, e.g. revenue or NPS. */
  NUMBER = 'NUMBER',
  /** Measured automatically: completed / total of the goal's linked tasks. */
  TASKS = 'TASKS',
}

@Entity('goals')
export class Goal {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') organizationId: string;
  @Column({ type: 'uuid', nullable: true }) projectId: string | null;
  @Column('uuid') ownerId: string;
  @Column() title: string;
  @Column({ type: 'text', default: '' }) description: string;
  @Column({ type: 'varchar', default: GoalStatus.ON_TRACK }) status: GoalStatus;
  @Column({ type: 'date', nullable: true }) dueDate: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;

  @ManyToOne(() => User) @JoinColumn({ name: 'owner_id' }) owner: User;
  @ManyToOne(() => Project, { nullable: true, onDelete: 'SET NULL' }) @JoinColumn({ name: 'project_id' }) project: Project | null;
  @OneToMany(() => KeyResult, (kr) => kr.goal) keyResults: KeyResult[];
  @ManyToMany(() => Task)
  @JoinTable({ name: 'goal_tasks', joinColumn: { name: 'goal_id' }, inverseJoinColumn: { name: 'task_id' } })
  tasks: Task[];
}

const numeric = { to: (v: number) => v, from: (v: string) => Number(v) };

@Entity('key_results')
export class KeyResult {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') goalId: string;
  @Column() title: string;
  @Column({ type: 'varchar', default: KeyResultKind.NUMBER }) kind: KeyResultKind;
  @Column({ type: 'numeric', default: 0, transformer: numeric }) startValue: number;
  @Column({ type: 'numeric', default: 100, transformer: numeric }) targetValue: number;
  @Column({ type: 'numeric', default: 0, transformer: numeric }) currentValue: number;
  @Column({ default: '' }) unit: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @ManyToOne(() => Goal, (g) => g.keyResults, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'goal_id' }) goal: Goal;
}
