import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { toStateDto } from '../workflow/workflow-state.entity';
import { toLabelDto } from '../labels/label.entity';
import { TaskLinkType } from './task-link.entity';
import { toUserSummary } from '../users/user.entity';
import { Task, TaskPriority, TaskStatus, TaskType } from './task.entity';

export class RecurrenceDto {
  @IsIn(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']) freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  @IsOptional() @IsInt() @Min(1) @Max(365) interval?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(7) @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) byWeekday?: number[];
  @IsOptional() @IsDateString() endDate?: string | null;
}

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
  /** Workflow state; takes precedence over `status` (which picks the first state of that category). */
  @IsOptional() @IsUUID() stateId?: string;
  @IsOptional() @ValidateNested() @Type(() => RecurrenceDto) recurrence?: RecurrenceDto | null;
  @IsOptional() @IsUUID() parentId?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(100000) estimateMinutes?: number | null;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID('all', { each: true }) labelIds?: string[];
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
  /** Workflow state; takes precedence over `status` (which picks the first state of that category). */
  @IsOptional() @IsUUID() stateId?: string;
  @IsOptional() @ValidateNested() @Type(() => RecurrenceDto) recurrence?: RecurrenceDto | null;
  @IsOptional() @IsUUID() parentId?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(100000) estimateMinutes?: number | null;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID('all', { each: true }) labelIds?: string[];
}

export class MoveTaskDto {
  /** Destination workflow state (preferred) … */
  @IsOptional() @IsUUID() stateId?: string;
  /** … or a status category (first state of that category). */
  @IsOptional() @IsEnum(TaskStatus) status?: TaskStatus;
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
  @IsOptional() @IsUUID() labelId?: string;
  @IsOptional() @IsUUID() stateId?: string;
  /** Parent task UUID, or `none` for top-level tasks only. */
  @IsOptional() @Matches(/^(none|[0-9a-fA-F-]{36})$/) parentId?: string;
  @IsOptional() @IsString() @MaxLength(200) q?: string;
  @IsOptional() @IsDateString() dueFrom?: string;
  @IsOptional() @IsDateString() dueTo?: string;
  @IsOptional() @IsIn(['true', 'false']) open?: 'true' | 'false';
  @IsOptional() @IsIn(['position', 'createdAt', 'updatedAt', 'dueDate', 'priority']) sort?: string;
  @IsOptional() @IsIn(['asc', 'desc']) order?: 'asc' | 'desc';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) size?: number;
}

export class AddLinkDto {
  /** Target task UUID or key. */
  @IsString() targetId: string;
  @IsEnum(TaskLinkType) type: TaskLinkType;
  /** `blocked_by` flips the direction: the target blocks this task. */
  @IsOptional() @IsIn(['outgoing', 'incoming']) direction?: 'outgoing' | 'incoming';
}

export class WatchDto {
  @IsOptional() @IsUUID() userId?: string;
}

export class BulkUpdateDto {
  @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) ids: string[];
  @ValidateNested() @Type(() => UpdateTaskDto) patch: UpdateTaskDto;
}

export interface TaskStats {
  subtaskCount: number;
  subtaskDone: number;
  blockedBy: number;
  loggedMinutes: number;
  commentCount: number;
  openPrs: number;
}
export const EMPTY_STATS: TaskStats = { subtaskCount: 0, subtaskDone: 0, blockedBy: 0, loggedMinutes: 0, commentCount: 0, openPrs: 0 };

export function toTaskDto(t: Task, stats: TaskStats = EMPTY_STATS) {
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
    stateId: t.stateId,
    state: t.state ? toStateDto(t.state) : null,
    recurrence: t.recurrence,
    seriesId: t.seriesId,
    parentId: t.parentId,
    parent: t.parent ? { id: t.parent.id, key: t.parent.key, title: t.parent.title, type: t.parent.type } : null,
    estimateMinutes: t.estimateMinutes,
    labels: (t.labels ?? []).map(toLabelDto).sort((a, b) => a.name.localeCompare(b.name)),
    ...stats,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    version: t.version,
  };
}
export type TaskDto = ReturnType<typeof toTaskDto>;
