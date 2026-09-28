import { Controller, Delete, Get, Module, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { CurrentUser } from '../../common/auth/decorators';
import { AuthPrincipal } from '../../common/auth/principal';
import { findProject } from '../projects/projects.service';
import { Favorite } from './favorite.entity';

/** Starred projects, pinned to the top of the navigation. */
@ApiTags('favorites')
@ApiBearerAuth()
@Controller()
export class FavoritesController {
  constructor(private readonly dataSource: DataSource) {}

  @Get('favorites')
  async list(@CurrentUser() u: AuthPrincipal) {
    const rows = await this.dataSource.query(
      `SELECT p.id, p.key, p.name, p.color FROM favorites f JOIN projects p ON p.id = f.project_id
        WHERE f.user_id = $1 AND p.organization_id = $2 ORDER BY f.created_at`,
      [u.userId, u.organizationId],
    );
    return rows;
  }

  @Post('projects/:id/favorite')
  async add(@CurrentUser() u: AuthPrincipal, @Param('id') id: string) {
    const project = await findProject(this.dataSource.manager, u.organizationId, id);
    await this.dataSource.getRepository(Favorite).upsert({ userId: u.userId, projectId: project.id }, ['userId', 'projectId']);
    return { projectId: project.id, favorite: true };
  }

  @Delete('projects/:id/favorite')
  async remove(@CurrentUser() u: AuthPrincipal, @Param('id') id: string) {
    const project = await findProject(this.dataSource.manager, u.organizationId, id);
    await this.dataSource.getRepository(Favorite).delete({ userId: u.userId, projectId: project.id });
    return { projectId: project.id, favorite: false };
  }
}

@Module({ controllers: [FavoritesController] })
export class FavoritesModule {}
