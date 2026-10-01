import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { DataSource, EntityManager } from 'typeorm';
import { AuthPrincipal, SignInMethod } from '../../common/auth/principal';
import { Role } from '../../common/auth/roles';
import { TokenService } from '../../common/auth/token.service';
import { ApiException } from '../../common/http/api-exception';
import { Membership } from '../organizations/membership.entity';
import { Organization } from '../organizations/organization.entity';
import { createOrganization } from '../organizations/organizations.service';
import { toUserSummary, User } from '../users/user.entity';
import { SsoConnection } from '../sso/sso.entity';
import { LoginDto, RegisterDto } from './auth.dto';
import { TwoFactorService } from './two-factor.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly tokens: TokenService,
    private readonly twoFactor: TwoFactorService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    const { user, org } = await this.dataSource.transaction(async (m) => {
      if (await m.existsBy(User, { email })) throw ApiException.conflict('EMAIL_TAKEN', 'An account with this email already exists');
      const user = await m.save(m.create(User, { email, name: dto.name.trim(), passwordHash: await bcrypt.hash(dto.password, 10) }));
      const org = await createOrganization(m, dto.organizationName, user.id);
      return { user, org };
    });
    return this.session(user.id, org.id);
  }

  async login(dto: LoginDto) {
    const user = await this.dataSource
      .getRepository(User)
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.email = :email', { email: dto.email.trim().toLowerCase() })
      .getOne();
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new ApiException(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
    }
    const memberships = await this.dataSource.getRepository(Membership).find({ where: { userId: user.id }, order: { createdAt: 'ASC' } });
    const membership = dto.organizationId ? memberships.find((m) => m.organizationId === dto.organizationId) : memberships[0];
    if (!membership) throw ApiException.forbidden('You are not a member of this organization');
    await this.assertPasswordAllowed(user.email, memberships);
    // Two-factor: a correct password only earns a short-lived challenge token.
    const totp = await this.dataSource.getRepository(User).findOne({ where: { id: user.id }, select: { id: true, totpEnabledAt: true } });
    if (totp?.totpEnabledAt) {
      return { mfaRequired: true as const, mfaToken: await this.tokens.issueMfaChallenge(user.id, membership.organizationId), methods: ['totp', 'recovery'] };
    }
    return this.session(user.id, membership.organizationId);
  }

  /** Second step of a 2FA sign-in. */
  async loginWithSecondFactor(mfaToken: string, code: string) {
    const challenge = await this.tokens.verifyMfaChallenge(mfaToken);
    if (!challenge) throw new ApiException(401, 'MFA_EXPIRED', 'This sign-in expired. Enter your password again.');
    if (!(await this.twoFactor.verifyForLogin(challenge.userId, code))) throw new ApiException(401, 'INVALID_CODE', 'That code is not valid');
    return this.session(challenge.userId, challenge.organizationId, 'mfa');
  }

  /**
   * When a workspace enforces SSO for the user's email domain, password sign-in is refused —
   * except for that workspace's owners, who keep password access as a break-glass.
   */
  private async assertPasswordAllowed(email: string, memberships: Membership[]) {
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain) return;
    const enforced = await this.dataSource
      .getRepository(SsoConnection)
      .createQueryBuilder('c')
      .where('c.enabled AND c.enforce AND c.domains ? :domain', { domain })
      .getMany();
    const hit = enforced.find((c) => memberships.some((m) => m.organizationId === c.organizationId && m.role !== Role.OWNER));
    if (hit) throw new ApiException(403, 'SSO_REQUIRED', `Your workspace signs in with ${hit.providerName}.`, { providerName: hit.providerName, connectionId: hit.id });
  }

  async switchOrganization(principal: AuthPrincipal, organizationId: string) {
    const exists = await this.dataSource.getRepository(Membership).existsBy({ userId: principal.userId, organizationId });
    if (!exists) throw ApiException.forbidden('You are not a member of this organization');
    // Keep the sign-in method: an SSO session stays an SSO session in the other workspace.
    return this.session(principal.userId, organizationId, principal.amr);
  }

  async session(userId: string, organizationId: string, amr: SignInMethod = 'pwd') {
    return { token: await this.tokens.issue(userId, organizationId, amr), ...(await this.me(userId, organizationId, amr)) };
  }

  async me(userId: string, organizationId: string, amr: SignInMethod = 'pwd') {
    return describeSession(this.dataSource.manager, userId, organizationId, amr);
  }
}

export async function describeSession(m: EntityManager, userId: string, organizationId: string, amr: SignInMethod = 'pwd') {
  const memberships = await m.find(Membership, { where: { userId }, relations: { organization: true, user: true }, order: { createdAt: 'ASC' } });
  const current = memberships.find((x) => x.organizationId === organizationId);
  if (!current) throw ApiException.forbidden('You are not a member of this organization');
  return {
    user: toUserSummary(current.user),
    organization: toOrganizationDto(current.organization),
    role: current.role as Role,
    organizations: memberships.map((x) => ({ ...toOrganizationDto(x.organization), role: x.role })),
    security: {
      signedInWith: amr,
      twoFactorEnabled: !!current.user.totpEnabledAt,
      workspaceRequiresTwoFactor: current.organization.require2fa,
      mfaSetupRequired: current.organization.require2fa && !current.user.totpEnabledAt && amr !== 'sso',
    },
  };
}

export const toOrganizationDto = (o: Organization) => ({ id: o.id, name: o.name, slug: o.slug });
