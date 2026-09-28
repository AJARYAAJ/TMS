import { Body, Controller, Delete, Get, Injectable, Module, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { DataSource } from 'typeorm';
import { CurrentUser, MinRole } from '../../common/auth/decorators';
import { AuthPrincipal } from '../../common/auth/principal';
import { Role } from '../../common/auth/roles';
import { ApiException } from '../../common/http/api-exception';
import { Membership } from '../organizations/membership.entity';
import { toUserSummary } from '../users/user.entity';
import { Team, TeamMember } from './team.entity';

class CreateTeamDto {
  @IsString() @MinLength(1) @MaxLength(120) name: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
}

class AddTeamMemberDto {
  @IsUUID() userId: string;
}

const toTeamDto = (t: Team) => ({
  id: t.id,
  name: t.name,
  description: t.description,
  createdAt: t.createdAt,
  members: (t.members ?? []).map((m) => toUserSummary(m.user)),
});

@Injectable()
export class TeamsService {
  constructor(private readonly dataSource: DataSource) {}

  async list(orgId: string) {
    const teams = await this.dataSource.getRepository(Team).find({
      where: { organizationId: orgId },
      relations: { members: { user: true } },
      order: { name: 'ASC' },
    });
    return teams.map(toTeamDto);
  }

  async get(orgId: string, id: string) {
    const team = await this.dataSource.getRepository(Team).findOne({ where: { id, organizationId: orgId }, relations: { members: { user: true } } });
    if (!team) throw ApiException.notFound('team');
    return team;
  }

  async create(orgId: string, dto: CreateTeamDto) {
    const repo = this.dataSource.getRepository(Team);
    const team = await repo.save(repo.create({ organizationId: orgId, name: dto.name.trim(), description: dto.description ?? '' }));
    return toTeamDto({ ...team, members: [] } as Team);
  }

  async remove(orgId: string, id: string) {
    await this.dataSource.getRepository(Team).remove(await this.get(orgId, id));
    return { removed: true };
  }

  async addMember(orgId: string, teamId: string, userId: string) {
    await this.get(orgId, teamId);
    if (!(await this.dataSource.getRepository(Membership).existsBy({ organizationId: orgId, userId }))) throw ApiException.notFound('user');
    const repo = this.dataSource.getRepository(TeamMember);
    if (!(await repo.existsBy({ teamId, userId }))) await repo.save(repo.create({ teamId, userId }));
    return toTeamDto(await this.get(orgId, teamId));
  }

  async removeMember(orgId: string, teamId: string, userId: string) {
    await this.get(orgId, teamId);
    await this.dataSource.getRepository(TeamMember).delete({ teamId, userId });
    return toTeamDto(await this.get(orgId, teamId));
  }
}

@ApiTags('teams')
@ApiBearerAuth()
@Controller('teams')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get()
  list(@CurrentUser() u: AuthPrincipal) {
    return this.teams.list(u.organizationId);
  }

  @Get(':id')
  async get(@CurrentUser() u: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return toTeamDto(await this.teams.get(u.organizationId, id));
  }

  @MinRole(Role.ADMIN)
  @Post()
  create(@CurrentUser() u: AuthPrincipal, @Body() dto: CreateTeamDto) {
    return this.teams.create(u.organizationId, dto);
  }

  @MinRole(Role.ADMIN)
  @Delete(':id')
  remove(@CurrentUser() u: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.teams.remove(u.organizationId, id);
  }

  @MinRole(Role.ADMIN)
  @Post(':id/members')
  addMember(@CurrentUser() u: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddTeamMemberDto) {
    return this.teams.addMember(u.organizationId, id, dto.userId);
  }

  @MinRole(Role.ADMIN)
  @Delete(':id/members/:userId')
  removeMember(@CurrentUser() u: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.teams.removeMember(u.organizationId, id, userId);
  }
}

@Module({ controllers: [TeamsController], providers: [TeamsService] })
export class TeamsModule {}
