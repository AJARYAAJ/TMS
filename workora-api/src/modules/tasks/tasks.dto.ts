import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { toUserSummary } from '../users/user.entity';
import { Task, TaskPriority, TaskStatus, TaskType } from './task.entity';

export class CreateTaskDto {
  /** Project UUID or key. */
  @IsString() projectId: string;
  @IsString() @MinLength(1) @MaxLength(500) title: string;
  @IsOptional() @IsString() @MaxLength(50000) description?: string;
  @IsOptional() @IsEnum(TaskType) type?: TaskType;
  @IsOptional() @IsEnum(TaskStatus) status?: TaskStatus;
  @IsOptional() @IsEnum(TaskPriority) priority?: TaskPriority;
  @IsOptional() @IsUUID() assigneeId?: string | null;
  @IsOptional() @IsUUID() sprintId?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(1000) storyPoints?: number | null;
  @IsOptional() @IsDateString() startDate?: string | null;
  @IsOptional() @IsDateString() dueDate?: string | null;
}

/** PATCH semantics: omitted fields are left unchanged; `null` clears a nullable field. */
export class UpdateTaskDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(500) title?: string;
  @IsOptional() @IsString() @MaxLength(50000) description?: string;
  @IsOptional() @IsEnum(TaskType) type?: TaskType;
  @IsOptional() @IsEnum(TaskStatus) status?: TaskStatus;
  @IsOptional() @IsEnum(TaskPriority) priority?: TaskPriority;
  @IsOptional() @IsUUID() assigneeId?: string | null;
  @IsOptional() @IsUUID() sprintId?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(1000) storyPoints?: number | null;
  @IsOptional() @IsDateString() startDate?: string | null;
  @IsOptional() @IsDateString() dueDate?: string | null;
}

export class MoveTaskDto {
  @IsEnum(TaskStatus) status: TaskStatus;
  /** Zero-based index within the destination column. */
  @IsInt() @Min(0) position: number;
}

export class ListTasksQuery {
  @IsOptional() @IsString() projectId?: string;
  /** Comma-separated list of statuses. */
  @IsOptional() @IsString() status?: string;
  /** User UUID, `me`, or `none`. */
  @IsOptional() @Matches(/^(me|none|[0-9a-fA-F-]{36})$/) assigneeId?: string;
  /** Sprint UUID, `none` (backlog) or `active`. */
  @IsOptional() @Matches(/^(none|active|[0-9a-fA-F-]{36})$/) sprintId?: string;
  @IsOptional() @IsEnum(TaskType) type?: TaskType;
  @IsOptional() @IsEnum(TaskPriority) priority?: TaskPriority;
  @IsOptional() @IsString() @MaxLength(200) q?: string;
  @IsOptional() @IsDateString() dueFrom?: string;
  @IsOptional() @IsDateString() dueTo?: string;
  @IsOptional() @IsIn(['true', 'false']) open?: 'true' | 'false';
  @IsOptional() @IsIn(['position', 'createdAt', 'updatedAt', 'dueDate', 'priority']) sort?: string;
  @IsOptional() @IsIn(['asc', 'desc']) order?: 'asc' | 'desc';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) size?: number;
}

export function toTaskDto(t: Task) {
  return {
    id: t.id,
    key: t.key,
    number: t.number,
    projectId: t.projectId,
    title: t.title,
    description: t.description,
    type: t.type,
    status: t.status,
    priority: t.priority,
    position: t.position,
    assignee: toUserSummary(t.assignee),
    reporter: toUserSummary(t.reporter),
    sprintId: t.sprintId,
    storyPoints: t.storyPoints,
    startDate: t.startDate,
    dueDate: t.dueDate,
    completedAt: t.completedAt,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    version: t.version,
  };
}
export type TaskDto = ReturnType<typeof toTaskDto>;
