import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Append-only audit / activity log, written by an event subscriber. */
@Entity('activities')
export class Activity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') organizationId: string;
  @Column({ type: 'uuid', nullable: true }) projectId: string | null;
  @Column({ type: 'uuid', nullable: true }) taskId: string | null;
  @Column({ type: 'uuid', nullable: true }) actorId: string | null;
  @Column({ type: 'varchar', nullable: true }) actorName: string | null;
  @Column() type: string;
  @Column('text') summary: string;
  @Column({ type: 'jsonb', default: {} }) data: Record<string, unknown>;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}
