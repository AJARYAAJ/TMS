import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { Membership } from '../../modules/organizations/membership.entity';
import { AuthPrincipal, JwtPayload, SignInMethod } from './principal';

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly dataSource: DataSource,
  ) {}

  issue(userId: string, organizationId: string, amr: SignInMethod = 'pwd') {
    const payload: JwtPayload = { sub: userId, org: organizationId, amr };
    return this.jwt.signAsync(payload);
  }

  /** After a correct password, when 2FA is on: proves step one for 5 minutes, nothing more. */
  issueMfaChallenge(userId: string, organizationId: string) {
    const payload: JwtPayload = { sub: userId, org: organizationId, typ: 'mfa' };
    return this.jwt.signAsync(payload, { expiresIn: '5m' });
  }

  async verifyMfaChallenge(token: string): Promise<{ userId: string; organizationId: string } | null> {
    try {
      const p = await this.jwt.verifyAsync<JwtPayload>(token);
      return p.typ === 'mfa' ? { userId: p.sub, organizationId: p.org } : null;
    } catch {
      return null;
    }
  }

  /**
   * Verifies the token and loads the *current* membership, so a revoked member or a
   * changed role takes effect immediately rather than when the token expires.
   */
  async authenticate(token: string | undefined | null): Promise<AuthPrincipal | null> {
    if (!token) return null;
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      return null;
    }
    if (payload.typ) return null; // challenge tokens are not sessions
    const membership = await this.dataSource.getRepository(Membership).findOne({
      where: { userId: payload.sub, organizationId: payload.org },
      relations: { user: true, organization: true },
    });
    if (!membership) return null;
    const amr = payload.amr ?? 'pwd';
    return {
      userId: membership.userId,
      organizationId: membership.organizationId,
      role: membership.role,
      email: membership.user.email,
      name: membership.user.name,
      amr,
      // SSO sign-ins are exempt: the identity provider enforces its own MFA.
      mfaSetupRequired: membership.organization.require2fa && !membership.user.totpEnabledAt && amr !== 'sso',
    };
  }
}
