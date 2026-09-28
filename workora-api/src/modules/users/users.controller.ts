import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { CurrentUser } from '../../common/auth/decorators';
import { AuthPrincipal } from '../../common/auth/principal';
import { Membership } from '../organizations/membership.entity';
import { toUserSummary } from './user.entity';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly dataSource: DataSource) {}

  /** Members of the current organization (for assignee pickers, mentions…). */
  @Get()
  async list(@CurrentUser() user: AuthPrincipal) {
    const rows = await this.dataSource.getRepository(Membership).find({
      where: { organizationId: user.organizationId },
      relations: { user: true },
    });
    return rows.map((m) => ({ ...toUserSummary(m.user)!, role: m.role })).sort((a, b) => a.name.localeCompare(b.name));
  }

  @Get('me')
  me(@CurrentUser() user: AuthPrincipal) {
    return { id: user.userId, name: user.name, email: user.email, role: user.role, organizationId: user.organizationId };
  }
}
