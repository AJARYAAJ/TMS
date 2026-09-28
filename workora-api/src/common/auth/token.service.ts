import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { Membership } from '../../modules/organizations/membership.entity';
import { AuthPrincipal, JwtPayload } from './principal';

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly dataSource: DataSource,
  ) {}

  issue(userId: string, organizationId: string) {
    const payload: JwtPayload = { sub: userId, org: organizationId };
    return this.jwt.signAsync(payload);
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
    const membership = await this.dataSource.getRepository(Membership).findOne({
      where: { userId: payload.sub, organizationId: payload.org },
      relations: { user: true },
    });
    if (!membership) return null;
    return {
      userId: membership.userId,
      organizationId: membership.organizationId,
      role: membership.role,
      email: membership.user.email,
      name: membership.user.name,
    };
  }
}
