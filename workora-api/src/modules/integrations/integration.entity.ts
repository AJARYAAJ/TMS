import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type Provider = 'slack' | 'github';

export interface SlackConfig {
  /** Slack Incoming Webhook URL for channel notifications (optional if only using the slash command). */
  webhookUrl?: string | null;
  /** Only notify about this project (null = every project). */
  projectId?: string | null;
  /** Domain event types to post (see SLACK_EVENTS). */
  events: string[];
  /** Project that `/workora create` adds tasks to. */
  commandProjectId?: string | null;
}

export interface GithubConfig {
  /** Only accept deliveries from this repository ("owner/name"); null = any repository. */
  repository?: string | null;
  /** Project for tasks created from GitHub issues. */
  projectId?: string | null;
  createTasksFromIssues: boolean;
  /** Workflow state (or status category) to move a task to when a linked PR opens. */
  onPrOpened?: string | null;
  /** …and when it merges (default: first "done" state). */
  onPrMerged?: string | null;
  /** Move tasks to done on "fixes KEY" commits to the default branch / closed issues. */
  closeOnKeywords: boolean;
}

@Entity('integrations')
export class Integration {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') organizationId: string;
  @Column({ type: 'varchar' }) provider: Provider;
  @Column() name: string;
  @Column({ type: 'jsonb', default: {} }) config: SlackConfig | GithubConfig | any;
  /** Slack signing secret or GitHub webhook secret. Never returned by the API after creation. */
  @Column({ type: 'varchar', nullable: true, select: false }) secret: string | null;
  @Column({ default: true }) enabled: boolean;
  @Column('uuid') createdById: string;
  @Column({ type: 'varchar', nullable: true }) lastStatus: string | null;
  @Column({ type: 'varchar', nullable: true }) lastError: string | null;
  @Column({ type: 'timestamptz', nullable: true }) lastActivityAt: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

export type LinkKind = 'pull_request' | 'commit' | 'issue' | 'branch';

@Entity('external_links')
export class ExternalLink {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') organizationId: string;
  @Column('uuid') taskId: string;
  @Column() provider: string;
  @Column({ type: 'varchar' }) kind: LinkKind;
  @Column() externalId: string;
  @Column() url: string;
  @Column() title: string;
  /** open / closed / merged / draft for PRs; open / closed for issues. */
  @Column({ type: 'varchar', nullable: true }) state: string | null;
  @Column({ type: 'varchar', nullable: true }) author: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}

export const toLinkDto = (l: ExternalLink) => ({
  id: l.id,
  provider: l.provider,
  kind: l.kind,
  externalId: l.externalId,
  url: l.url,
  title: l.title,
  state: l.state,
  author: l.author,
  updatedAt: l.updatedAt,
});
