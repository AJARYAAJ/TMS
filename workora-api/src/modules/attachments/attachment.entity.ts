import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from '../users/user.entity';

@Entity('attachments')
export class Attachment {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') organizationId: string;
  @Column('uuid') taskId: string;
  @Column('uuid') uploaderId: string;
  @Column() fileName: string;
  @Column() contentType: string;
  @Column('int') size: number;
  @Column({ unique: true }) storageKey: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @ManyToOne(() => User) @JoinColumn({ name: 'uploader_id' }) uploader: User;
}
