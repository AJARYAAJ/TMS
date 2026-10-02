import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') organizationId: string;
  @Column('uuid') userId: string;
  @Column({ type: 'uuid', nullable: true }) actorId: string | null;
  @Column({ type: 'varchar', nullable: true }) actorName: string | null;
  @Column() type: string;
  /** Preference category (assigned, mentioned, …, security). */
  @Column({ type: 'varchar', nullable: true }) category: string | null;
  /** In-app path for notifications that aren't about a task (a goal, a form, Settings). */
  @Column({ type: 'varchar', nullable: true }) link: string | null;
  @Column() title: string;
  @Column({ type: 'text', default: '' }) body: string;
  @Column({ type: 'uuid', nullable: true }) projectId: string | null;
  @Column({ type: 'uuid', nullable: true }) taskId: string | null;
  @Column({ type: 'varchar', nullable: true }) taskKey: string | null;
  @Column({ type: 'timestamptz', nullable: true }) readAt: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}
