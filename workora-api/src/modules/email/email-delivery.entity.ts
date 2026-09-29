import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type DeliveryStatus = 'sent' | 'failed' | 'skipped';

/** Final outcome of one notification email (retries are folded into `attempts`). */
@Entity('email_deliveries')
export class EmailDelivery {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid', nullable: true }) organizationId: string | null;
  @Column({ type: 'uuid', nullable: true }) userId: string | null;
  @Column() recipient: string;
  @Column() category: string;
  @Column() subject: string;
  @Column({ type: 'varchar' }) status: DeliveryStatus;
  @Column({ type: 'varchar', nullable: true }) error: string | null;
  @Column({ type: 'varchar', nullable: true }) messageId: string | null;
  @Column({ default: 1 }) attempts: number;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

export const toDeliveryDto = (d: EmailDelivery) => ({
  id: d.id,
  recipient: d.recipient,
  category: d.category,
  subject: d.subject,
  status: d.status,
  error: d.error,
  attempts: d.attempts,
  createdAt: d.createdAt,
});
