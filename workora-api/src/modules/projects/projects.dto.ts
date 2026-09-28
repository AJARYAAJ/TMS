import { IsEnum, IsHexColor, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { toUserSummary } from '../users/user.entity';
import { Project, ProjectStatus } from './project.entity';

export class CreateProjectDto {
  @IsString() @MinLength(1) @MaxLength(120) name: string;
  @IsOptional() @Matches(/^[A-Z][A-Z0-9]{1,9}$/, { message: 'key must be 2-10 uppercase letters/digits starting with a letter' }) key?: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @IsHexColor() color?: string;
}

export class UpdateProjectDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @IsHexColor() color?: string;
  @IsOptional() @IsEnum(ProjectStatus) status?: ProjectStatus;
}

export function toProjectDto(p: Project, counts?: { total: number; open: number }, isFavorite = false) {
  return {
    id: p.id,
    key: p.key,
    name: p.name,
    description: p.description,
    status: p.status,
    color: p.color,
    owner: toUserSummary(p.owner),
    taskCount: counts?.total ?? 0,
    openTaskCount: counts?.open ?? 0,
    isFavorite,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}
export type ProjectDto = ReturnType<typeof toProjectDto>;
