import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum SprintStatus {
  PLANNED = 'PLANNED',
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
}

@Entity('sprints')
export class Sprint {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') organizationId: string;
  @Column('uuid') projectId: string;
  @Column() name: string;
  @Column({ type: 'text', default: '' }) goal: string;
  @Column({ type: 'varchar', default: SprintStatus.PLANNED }) status: SprintStatus;
  @Column({ type: 'date', nullable: true }) startDate: string | null;
  @Column({ type: 'date', nullable: true }) endDate: string | null;
  @Column({ type: 'timestamptz', nullable: true }) completedAt: Date | null;
  /** Snapshot taken on completion (velocity): what was committed vs. done. */
  @Column({ type: 'jsonb', nullable: true }) completionStats: SprintCompletionStats | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

export interface SprintCompletionStats {
  committedPoints: number;
  completedPoints: number;
  committedCount: number;
  completedCount: number;
}
