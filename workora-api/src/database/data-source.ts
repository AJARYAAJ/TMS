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
import { WorkflowsAndRecurrence1727700000000 } from './migrations/1727700000000-WorkflowsAndRecurrence';
import { SlackGithubIntegrations1727800000000 } from './migrations/1727800000000-SlackGithubIntegrations';
import { EmailNotifications1727900000000 } from './migrations/1727900000000-EmailNotifications';
import { WorkManagementPlus1728000000000 } from './migrations/1728000000000-WorkManagementPlus';
import { LabelDescriptions1728100000000 } from './migrations/1728100000000-LabelDescriptions';
import { TwoFactorAndSso1728200000000 } from './migrations/1728200000000-TwoFactorAndSso';
import { SsoConnection, UserIdentity } from '../modules/sso/sso.entity';
import { CustomField } from '../modules/fields/custom-field.entity';
import { SavedView } from '../modules/views/views.module';
import { Form } from '../modules/forms/forms.module';
import { ExternalLink, Integration } from '../modules/integrations/integration.entity';
import { WorkflowState } from '../modules/workflow/workflow-state.entity';
import { EmailDelivery } from '../modules/email/email-delivery.entity';
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
  TimeEntry, Goal, KeyResult, Document, Automation, Webhook, WebhookDelivery, Favorite, WorkflowState, Integration, ExternalLink,
  EmailDelivery, CustomField, SavedView, Form, SsoConnection, UserIdentity,
];

export function dataSourceOptions(url = loadConfig().databaseUrl): DataSourceOptions {
  return {
    type: 'postgres',
    url,
    entities: ENTITIES,
    migrations: [InitialSchema1727500000000, WorkManagementExtensions1727600000000, WorkflowsAndRecurrence1727700000000, SlackGithubIntegrations1727800000000, EmailNotifications1727900000000, WorkManagementPlus1728000000000, LabelDescriptions1728100000000, TwoFactorAndSso1728200000000],
    migrationsRun: true,
    synchronize: false,
    namingStrategy: new SnakeNamingStrategy(),
  };
}

/** Used by the TypeORM CLI (npm run migration:run). */
export default new DataSource(dataSourceOptions());
