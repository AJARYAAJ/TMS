import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { Role } from '../../common/auth/roles';

/** One OpenID Connect identity provider per organization (Okta, Entra ID, Google Workspace, Auth0…). */
@Entity('sso_connections')
export class SsoConnection {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') organizationId: string;
  /** Shown on the sign-in button: "Continue with Okta". */
  @Column() providerName: string;
  @Column() issuer: string;
  @Column() clientId: string;
  /** Encrypted with SecretBox; never returned by the API. */
  @Column({ select: false }) clientSecret: string;
  /** Email domains routed to this provider (also the only ones it may sign in). */
  @Column({ type: 'jsonb', default: [] }) domains: string[];
  /** Create accounts/memberships on first sign-in. */
  @Column({ default: true }) autoProvision: boolean;
  @Column({ type: 'varchar', default: Role.MEMBER }) defaultRole: Role;
  /** Members on these domains must use SSO (owners keep password access as break-glass). */
  @Column({ default: false }) enforce: boolean;
  @Column({ default: true }) enabled: boolean;
  @Column({ type: 'timestamptz', nullable: true }) lastLoginAt: Date | null;
  @Column({ type: 'varchar', nullable: true }) lastError: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

/** A user's account at an identity provider (`sub` is stable even if their email changes). */
@Entity('user_identities')
export class UserIdentity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') userId: string;
  @Column('uuid') connectionId: string;
  @Column() subject: string;
  @Column() email: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) lastLoginAt: Date | null;
}

export const toConnectionDto = (c: SsoConnection) => ({
  id: c.id,
  providerName: c.providerName,
  issuer: c.issuer,
  clientId: c.clientId,
  hasClientSecret: true,
  domains: c.domains,
  autoProvision: c.autoProvision,
  defaultRole: c.defaultRole,
  enforce: c.enforce,
  enabled: c.enabled,
  lastLoginAt: c.lastLoginAt,
  lastError: c.lastError,
});
