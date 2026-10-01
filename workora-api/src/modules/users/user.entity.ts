import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ unique: true }) email: string;
  @Column() name: string;
  @Column({ select: false }) passwordHash: string;
  /** Overrides of the default email preferences (see modules/email/email-prefs.ts). */
  @Column({ type: 'jsonb', default: {}, select: false }) emailPrefs: Record<string, boolean>;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

export interface UserSummary {
  id: string;
  name: string;
  email: string;
}

export const toUserSummary = (u: User | null | undefined): UserSummary | null =>
  u ? { id: u.id, name: u.name, email: u.email } : null;
