import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Task } from './task.entity';

export enum TaskLinkType {
  /** source blocks target (target is "blocked by" source) */
  BLOCKS = 'BLOCKS',
  RELATES = 'RELATES',
  DUPLICATES = 'DUPLICATES',
}

@Entity('task_links')
export class TaskLink {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') organizationId: string;
  @Column('uuid') sourceTaskId: string;
  @Column('uuid') targetTaskId: string;
  @Column({ type: 'varchar' }) type: TaskLinkType;
  @Column({ type: 'uuid', nullable: true }) createdById: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @ManyToOne(() => Task, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'source_task_id' }) source: Task;
  @ManyToOne(() => Task, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'target_task_id' }) target: Task;
}
