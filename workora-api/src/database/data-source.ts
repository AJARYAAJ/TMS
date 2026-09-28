import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';
import { SnakeNamingStrategy } from '../common/database/snake-naming.strategy';
import { loadConfig } from '../config';
import { Activity } from '../modules/activity/activity.entity';
import { Attachment } from '../modules/attachments/attachment.entity';
import { Comment } from '../modules/comments/comment.entity';
import { Notification } from '../modules/notifications/notification.entity';
import { Membership } from '../modules/organizations/membership.entity';
import { Organization } from '../modules/organizations/organization.entity';
import { Project } from '../modules/projects/project.entity';
import { Sprint } from '../modules/sprints/sprint.entity';
import { Task } from '../modules/tasks/task.entity';
import { Team, TeamMember } from '../modules/teams/team.entity';
import { User } from '../modules/users/user.entity';
import { InitialSchema1727500000000 } from './migrations/1727500000000-InitialSchema';
import { WorkManagementExtensions1727600000000 } from './migrations/1727600000000-WorkManagementExtensions';
import { Automation } from '../modules/automations/automation.entity';
import { Document } from '../modules/documents/document.entity';
import { Favorite } from '../modules/favorites/favorite.entity';
import { Goal, KeyResult } from '../modules/goals/goal.entity';
import { Webhook, WebhookDelivery } from '../modules/integrations/webhook.entity';
import { Label } from '../modules/labels/label.entity';
import { TaskLink } from '../modules/tasks/task-link.entity';
import { TimeEntry } from '../modules/time/time-entry.entity';

export const ENTITIES = [
  User, Organization, Membership, Team, TeamMember, Project, Sprint, Task, TaskLink, Label, Comment, Attachment, Activity, Notification,
  TimeEntry, Goal, KeyResult, Document, Automation, Webhook, WebhookDelivery, Favorite,
];

export function dataSourceOptions(url = loadConfig().databaseUrl): DataSourceOptions {
  return {
    type: 'postgres',
    url,
    entities: ENTITIES,
    migrations: [InitialSchema1727500000000, WorkManagementExtensions1727600000000],
    migrationsRun: true,
    synchronize: false,
    namingStrategy: new SnakeNamingStrategy(),
  };
}

/** Used by the TypeORM CLI (npm run migration:run). */
export default new DataSource(dataSourceOptions());
