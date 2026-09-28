import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { JwtAuthGuard, RolesGuard, UserThrottlerGuard } from './common/auth/guards';
import { CommonModule } from './common/common.module';
import { REDIS, RedisModule } from './common/redis.module';
import { ApiExceptionFilter } from './common/http/exception.filter';
import { RedisThrottlerStorage } from './common/http/redis-throttler.storage';
import { ResponseEnvelopeInterceptor } from './common/http/response.interceptor';
import { loadConfig } from './config';
import { dataSourceOptions } from './database/data-source';
import { ActivityModule } from './modules/activity/activity.module';
import { AttachmentsModule } from './modules/attachments/attachments.module';
import { AuthModule } from './modules/auth/auth.module';
import { CommentsModule } from './modules/comments/comments.module';
import { redisConnection } from './modules/jobs/jobs.constants';
import { JobsModule } from './modules/jobs/jobs.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SearchModule } from './modules/search/search.module';
import { SprintsModule } from './modules/sprints/sprints.module';
import { StorageModule } from './modules/storage/storage.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { TeamsModule } from './modules/teams/teams.module';
import { UsersModule } from './modules/users/users.module';
import { AutomationsModule } from './modules/automations/automations.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { FavoritesModule } from './modules/favorites/favorites.module';
import { GoalsModule } from './modules/goals/goals.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { LabelsModule } from './modules/labels/labels.module';
import { RoadmapModule } from './modules/roadmap/roadmap.module';
import { TimeModule } from './modules/time/time.module';

@Module({
  imports: [
    CommonModule,
    TypeOrmModule.forRootAsync({ useFactory: () => dataSourceOptions(loadConfig().databaseUrl) }),
    EventEmitterModule.forRoot(),
    BullModule.forRootAsync({ useFactory: () => ({ connection: redisConnection(loadConfig().redisUrl), prefix: loadConfig().queuePrefix }) }),
    RedisModule,
    ThrottlerModule.forRootAsync({
      inject: [REDIS],
      useFactory: (redis: Redis) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: loadConfig().rateLimitPerMinute }],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
    // Feature modules (modular monolith: each owns its entities, API and event subscribers).
    AuthModule,
    OrganizationsModule,
    UsersModule,
    TeamsModule,
    ProjectsModule,
    TasksModule,
    SprintsModule,
    CommentsModule,
    StorageModule,
    AttachmentsModule,
    ActivityModule,
    RealtimeModule,
    JobsModule,
    NotificationsModule,
    SearchModule,
    ReportsModule,
    LabelsModule,
    TimeModule,
    GoalsModule,
    DocumentsModule,
    AutomationsModule,
    IntegrationsModule,
    FavoritesModule,
    RoadmapModule,
  ],
  providers: [
    // Order matters: authenticate first, then rate-limit per user, then check RBAC.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: UserThrottlerGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
