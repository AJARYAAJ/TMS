import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('organizations')
export class Organization {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() name: string;
  @Column({ unique: true }) slug: string;
  /** Every member must turn on two-factor authentication (password sign-ins). */
  @Column({ name: 'require_2fa', default: false }) require2fa: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}
