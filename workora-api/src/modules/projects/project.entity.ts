import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { User } from '../users/user.entity';

export enum ProjectStatus {
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
}

@Entity('projects')
@Unique(['organizationId', 'key'])
export class Project {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') organizationId: string;
  @Column() key: string;
  @Column() name: string;
  @Column({ type: 'text', default: '' }) description: string;
  @Column({ type: 'varchar', default: ProjectStatus.ACTIVE }) status: ProjectStatus;
  @Column({ default: '#6366f1' }) color: string;
  @Column('uuid') ownerId: string;
  @Column({ type: 'int', default: 0 }) taskSeq: number;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;

  @ManyToOne(() => User) @JoinColumn({ name: 'owner_id' }) owner: User;
}
