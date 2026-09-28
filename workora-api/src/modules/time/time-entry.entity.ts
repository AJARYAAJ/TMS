import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Task } from '../tasks/task.entity';
import { User } from '../users/user.entity';

@Entity('time_entries')
export class TimeEntry {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') organizationId: string;
  @Column('uuid') taskId: string;
  @Column('uuid') userId: string;
  @Column({ type: 'timestamptz' }) startedAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) endedAt: Date | null;
  /** Null while a timer is running. */
  @Column({ type: 'int', nullable: true }) minutes: number | null;
  @Column({ type: 'text', default: '' }) note: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @ManyToOne(() => Task, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'task_id' }) task: Task;
  @ManyToOne(() => User) @JoinColumn({ name: 'user_id' }) user: User;
}
