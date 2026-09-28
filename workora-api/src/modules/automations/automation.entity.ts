import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type AutomationTrigger =
  | { event: 'TASK_CREATED' }
  | { event: 'STATUS_CHANGED'; from?: string; to?: string }
  | { event: 'PRIORITY_CHANGED'; to?: string }
  | { event: 'ASSIGNED' }
  | { event: 'COMMENT_ADDED' }
  | { event: 'TASK_OVERDUE' };

export interface AutomationConditions {
  type?: string;
  priority?: string;
  labelId?: string;
}

export type AutomationAction =
  | { type: 'SET_STATUS'; status: string }
  | { type: 'SET_PRIORITY'; priority: string }
  | { type: 'ASSIGN'; userId: string }
  | { type: 'ASSIGN_REPORTER' }
  | { type: 'UNASSIGN' }
  | { type: 'ADD_LABEL'; labelId: string }
  | { type: 'MOVE_TO_ACTIVE_SPRINT' }
  | { type: 'MOVE_TO_BACKLOG' }
  | { type: 'ADD_COMMENT'; body: string }
  | { type: 'NOTIFY'; target: 'ASSIGNEE' | 'REPORTER' | 'WATCHERS' | 'USER'; userId?: string; message: string };

@Entity('automations')
export class Automation {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') organizationId: string;
  @Column('uuid') projectId: string;
  @Column() name: string;
  @Column({ default: true }) enabled: boolean;
  @Column({ type: 'jsonb' }) trigger: AutomationTrigger;
  @Column({ type: 'jsonb', default: {} }) conditions: AutomationConditions;
  @Column({ type: 'jsonb' }) actions: AutomationAction[];
  @Column({ type: 'int', default: 0 }) runCount: number;
  @Column({ type: 'timestamptz', nullable: true }) lastRunAt: Date | null;
  @Column('uuid') createdById: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}
