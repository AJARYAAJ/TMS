import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ unique: true }) email: string;
  @Column() name: string;
  @Column({ select: false }) passwordHash: string;
  /** Overrides of the default email preferences (see modules/email/email-prefs.ts). */
  @Column({ type: 'jsonb', default: {}, select: false }) emailPrefs: Record<string, boolean>;
  @Column({ type: 'jsonb', default: {}, select: false }) pushPrefs: Record<string, boolean>;
  /** Encrypted TOTP seed once two-factor authentication is on (SecretBox). */
  @Column({ type: 'varchar', nullable: true, select: false }) totpSecret: string | null;
  /** Encrypted seed shown during setup, promoted to totpSecret after the first valid code. */
  @Column({ type: 'varchar', nullable: true, select: false }) totpPendingSecret: string | null;
  @Column({ type: 'timestamptz', nullable: true }) totpEnabledAt: Date | null;
  /** Last accepted time step: a code can't be used twice. */
  @Column({ type: 'bigint', nullable: true, select: false }) totpLastStep: string | null;
  /** SHA-256 hashes of unused recovery codes. */
  @Column({ type: 'jsonb', default: [], select: false }) recoveryCodes: string[];
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

export interface UserSummary {
  id: string;
  name: string;
  email: string;
}

export const toUserSummary = (u: User | null | undefined): UserSummary | null =>
  u ? { id: u.id, name: u.name, email: u.email } : null;
