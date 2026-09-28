import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('webhooks')
export class Webhook {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') organizationId: string;
  @Column() name: string;
  @Column() url: string;
  @Column({ select: false }) secret: string;
  /** Domain event types to deliver; ["*"] means all. */
  @Column({ type: 'jsonb', default: ['*'] }) events: string[];
  @Column({ default: true }) enabled: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

@Entity('webhook_deliveries')
export class WebhookDelivery {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') webhookId: string;
  @Column('uuid') eventId: string;
  @Column() eventType: string;
  @Column('int') attempt: number;
  @Column({ type: 'int', nullable: true }) statusCode: number | null;
  @Column() success: boolean;
  @Column('int') durationMs: number;
  @Column({ type: 'varchar', nullable: true }) error: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}
