import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { actorOf, AuthPrincipal } from '../../common/auth/principal';
import { Role } from '../../common/auth/roles';
import { EventBus } from '../../common/events/event-bus.service';
import { ApiException } from '../../common/http/api-exception';
import { toOrganizationDto } from '../auth/auth.service';
import { toUserSummary, User } from '../users/user.entity';
import { Membership } from './membership.entity';
import { Organization } from './organization.entity';
import { AddMemberDto } from './organizations.dto';

export async function createOrganization(m: EntityManager, name: string, ownerId: string) {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'org';
  let slug = base;
  while (await m.existsBy(Organization, { slug })) slug = `${base}-${randomBytes(3).toString('hex')}`;
  const org = await m.save(m.create(Organization, { name: name.trim(), slug }));
  await m.save(m.create(Membership, { organizationId: org.id, userId: ownerId, role: Role.OWNER }));
  return org;
}

const toMemberDto = (m: Membership) => ({ user: toUserSummary(m.user), role: m.role, joinedAt: m.createdAt, twoFactorEnabled: !!m.user?.totpEnabledAt });

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
  ) {}

  async create(principal: AuthPrincipal, name: string) {
    const org = await this.dataSource.transaction((m) => createOrganization(m, name, principal.userId));
    return { ...toOrganizationDto(org), role: Role.OWNER };
  }

  async current(orgId: string) {
    const org = await this.dataSource.getRepository(Organization).findOneByOrFail({ id: orgId });
    const memberCount = await this.dataSource.getRepository(Membership).countBy({ organizationId: orgId });
    return { ...toOrganizationDto(org), memberCount, createdAt: org.createdAt, require2fa: org.require2fa };
  }

  async members(orgId: string) {
    const rows = await this.dataSource.getRepository(Membership).find({
      where: { organizationId: orgId },
      relations: { user: true },
      order: { createdAt: 'ASC' },
    });
    return rows.map(toMemberDto);
  }

  /** Workspace security policy. Turning on "require 2FA" demands the admin has it themselves (no lock-out). */
  async setSecurity(principal: AuthPrincipal, require2fa: boolean) {
    if (require2fa && principal.amr !== 'sso') {
      const me = await this.dataSource.getRepository(User).findOneByOrFail({ id: principal.userId });
      if (!me.totpEnabledAt) throw ApiException.badRequest('MFA_REQUIRED_FIRST', 'Turn on two-factor authentication for your own account first');
    }
    await this.dataSource.getRepository(Organization).update({ id: principal.organizationId }, { require2fa });
    const members = await this.members(principal.organizationId);
    return { require2fa, membersWithout2fa: members.filter((m) => !m.twoFactorEnabled).length };
  }

  async addMember(principal: AuthPrincipal, dto: AddMemberDto) {
    if (dto.role === Role.OWNER && principal.role !== Role.OWNER) throw ApiException.forbidden('Only owners can add owners');
    const email = dto.email.trim().toLowerCase();
    const membership = await this.dataSource.transaction(async (m) => {
      let user = await m.findOneBy(User, { email });
      if (!user) {
        if (!dto.name || !dto.password) {
          throw ApiException.badRequest('USER_DETAILS_REQUIRED', 'No account exists for this email; provide name and password to create one');
        }
        user = await m.save(m.create(User, { email, name: dto.name.trim(), passwordHash: await bcrypt.hash(dto.password, 10) }));
      } else if (await m.existsBy(Membership, { organizationId: principal.organizationId, userId: user.id })) {
        throw ApiException.conflict('ALREADY_MEMBER', 'This user is already a member of the organization');
      }
      const saved = await m.save(m.create(Membership, { organizationId: principal.organizationId, userId: user.id, role: dto.role }));
      saved.user = user;
      return saved;
    });
    const dto$ = toMemberDto(membership);
    this.events.publish('USER_ADDED', { organizationId: principal.organizationId, actor: actorOf(principal), data: dto$ });
    return dto$;
  }

  async updateRole(principal: AuthPrincipal, userId: string, role: Role) {
    return this.dataSource.transaction(async (m) => {
      const target = await this.loadForChange(m, principal, userId);
      if (role === Role.OWNER && principal.role !== Role.OWNER) throw ApiException.forbidden('Only owners can grant the owner role');
      if (target.role === Role.OWNER && role !== Role.OWNER) await this.ensureAnotherOwner(m, principal.organizationId);
      target.role = role;
      await m.save(target);
      return toMemberDto(target);
    });
  }

  async removeMember(principal: AuthPrincipal, userId: string) {
    await this.dataSource.transaction(async (m) => {
      const target = await this.loadForChange(m, principal, userId);
      if (target.role === Role.OWNER) await this.ensureAnotherOwner(m, principal.organizationId);
      await m.remove(target);
    });
    return { removed: true };
  }

  private async loadForChange(m: EntityManager, principal: AuthPrincipal, userId: string) {
    if (userId === principal.userId) throw ApiException.badRequest('CANNOT_CHANGE_SELF', 'You cannot change your own membership');
    const target = await m.findOne(Membership, { where: { organizationId: principal.organizationId, userId }, relations: { user: true } });
    if (!target) throw ApiException.notFound('member');
    if (target.role === Role.OWNER && principal.role !== Role.OWNER) throw ApiException.forbidden('Only owners can change other owners');
    return target;
  }

  private async ensureAnotherOwner(m: EntityManager, organizationId: string) {
    const owners = await m.countBy(Membership, { organizationId, role: Role.OWNER });
    if (owners <= 1) throw ApiException.badRequest('LAST_OWNER', 'An organization must keep at least one owner');
  }
}
