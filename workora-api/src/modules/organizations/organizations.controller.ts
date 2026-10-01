import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, MinRole } from '../../common/auth/decorators';
import { AuthPrincipal } from '../../common/auth/principal';
import { Role } from '../../common/auth/roles';
import { describeSession } from '../auth/auth.service';
import { AddMemberDto, CreateOrganizationDto, SecurityPolicyDto, UpdateMemberDto } from './organizations.dto';
import { OrganizationsService } from './organizations.service';
import { DataSource } from 'typeorm';

@ApiTags('organizations')
@ApiBearerAuth()
@Controller('organizations')
export class OrganizationsController {
  constructor(
    private readonly orgs: OrganizationsService,
    private readonly dataSource: DataSource,
  ) {}

  @Get()
  async mine(@CurrentUser() user: AuthPrincipal) {
    return (await describeSession(this.dataSource.manager, user.userId, user.organizationId)).organizations;
  }

  @Post()
  create(@CurrentUser() user: AuthPrincipal, @Body() dto: CreateOrganizationDto) {
    return this.orgs.create(user, dto.name);
  }

  @Get('current')
  current(@CurrentUser() user: AuthPrincipal) {
    return this.orgs.current(user.organizationId);
  }

  /** Security policy: require two-factor authentication for every member. */
  @MinRole(Role.ADMIN)
  @Patch('current/security')
  security(@CurrentUser() user: AuthPrincipal, @Body() dto: SecurityPolicyDto) {
    return this.orgs.setSecurity(user, dto.require2fa);
  }

  @Get('current/members')
  members(@CurrentUser() user: AuthPrincipal) {
    return this.orgs.members(user.organizationId);
  }

  @MinRole(Role.ADMIN)
  @Post('current/members')
  addMember(@CurrentUser() user: AuthPrincipal, @Body() dto: AddMemberDto) {
    return this.orgs.addMember(user, dto);
  }

  @MinRole(Role.ADMIN)
  @Patch('current/members/:userId')
  updateMember(@CurrentUser() user: AuthPrincipal, @Param('userId', ParseUUIDPipe) userId: string, @Body() dto: UpdateMemberDto) {
    return this.orgs.updateRole(user, userId, dto.role);
  }

  @MinRole(Role.ADMIN)
  @Delete('current/members/:userId')
  removeMember(@CurrentUser() user: AuthPrincipal, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.orgs.removeMember(user, userId);
  }
}
