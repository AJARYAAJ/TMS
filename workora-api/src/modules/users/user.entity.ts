import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ unique: true }) email: string;
  @Column() name: string;
  @Column({ select: false }) passwordHash: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

export interface UserSummary {
  id: string;
  name: string;
  email: string;
}

export const toUserSummary = (u: User | null | undefined): UserSummary | null =>
  u ? { id: u.id, name: u.name, email: u.email } : null;
