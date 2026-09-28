import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { User } from '../users/user.entity';

@Entity('documents')
export class Document {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') organizationId: string;
  @Column({ type: 'uuid', nullable: true }) projectId: string | null;
  @Column() title: string;
  @Column({ default: '📄' }) icon: string;
  @Column({ type: 'text', default: '' }) content: string;
  @Column('uuid') authorId: string;
  @Column({ type: 'uuid', nullable: true }) updatedById: string | null;
  /** Incremented on every save; clients send the version they edited for conflict detection. */
  @Column({ type: 'int', default: 1 }) version: number;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
  @ManyToOne(() => User) @JoinColumn({ name: 'author_id' }) author: User;
  @ManyToOne(() => User, { nullable: true }) @JoinColumn({ name: 'updated_by_id' }) updatedBy: User | null;
}
