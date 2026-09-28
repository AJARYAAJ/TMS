import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { DataSource, EntityManager } from 'typeorm';
import { AuthPrincipal } from '../../common/auth/principal';
import { Role } from '../../common/auth/roles';
import { TokenService } from '../../common/auth/token.service';
import { ApiException } from '../../common/http/api-exception';
import { Membership } from '../organizations/membership.entity';
import { Organization } from '../organizations/organization.entity';
import { createOrganization } from '../organizations/organizations.service';
import { toUserSummary, User } from '../users/user.entity';
import { LoginDto, RegisterDto } from './auth.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly tokens: TokenService,
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
    return this.session(user.id, membership.organizationId);
  }

  async switchOrganization(principal: AuthPrincipal, organizationId: string) {
    const exists = await this.dataSource.getRepository(Membership).existsBy({ userId: principal.userId, organizationId });
    if (!exists) throw ApiException.forbidden('You are not a member of this organization');
    return this.session(principal.userId, organizationId);
  }

  async session(userId: string, organizationId: string) {
    return { token: await this.tokens.issue(userId, organizationId), ...(await this.me(userId, organizationId)) };
  }

  async me(userId: string, organizationId: string) {
    return describeSession(this.dataSource.manager, userId, organizationId);
  }
}

export async function describeSession(m: EntityManager, userId: string, organizationId: string) {
  const memberships = await m.find(Membership, { where: { userId }, relations: { organization: true, user: true }, order: { createdAt: 'ASC' } });
  const current = memberships.find((x) => x.organizationId === organizationId);
  if (!current) throw ApiException.forbidden('You are not a member of this organization');
  return {
    user: toUserSummary(current.user),
    organization: toOrganizationDto(current.organization),
    role: current.role as Role,
    organizations: memberships.map((x) => ({ ...toOrganizationDto(x.organization), role: x.role })),
  };
}

export const toOrganizationDto = (o: Organization) => ({ id: o.id, name: o.name, slug: o.slug });
