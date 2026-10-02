export type Role = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type TaskType = 'TASK' | 'BUG' | 'STORY' | 'EPIC';
export type SprintStatus = 'PLANNED' | 'ACTIVE' | 'COMPLETED';

export const TASK_STATUSES: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'];
export const TASK_PRIORITIES: TaskPriority[] = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'];
export const TASK_TYPES: TaskType[] = ['TASK', 'BUG', 'STORY', 'EPIC'];

export interface UserSummary {
  id: string;
  name: string;
  email: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  role?: Role;
}

export interface Session {
  token: string;
  user: UserSummary;
  organization: Organization;
  role: Role;
  organizations: Organization[];
  security?: SessionSecurity;
}

export interface SessionSecurity {
  signedInWith: 'pwd' | 'mfa' | 'sso';
  twoFactorEnabled: boolean;
  workspaceRequiresTwoFactor: boolean;
  mfaSetupRequired: boolean;
}

export interface MfaChallenge {
  mfaRequired: true;
  mfaToken: string;
  methods: string[];
}

export interface TwoFactorStatus {
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesLeft: number;
  requiredByWorkspace: boolean;
  signedInWith: 'pwd' | 'mfa' | 'sso';
}

export interface SsoConnection {
  id: string;
  providerName: string;
  issuer: string;
  clientId: string;
  hasClientSecret: boolean;
  domains: string[];
  autoProvision: boolean;
  defaultRole: Role;
  enforce: boolean;
  enabled: boolean;
  lastLoginAt: string | null;
  lastError: string | null;
}

export interface Project {
  id: string;
  key: string;
  name: string;
  description: string;
  status: 'ACTIVE' | 'ARCHIVED';
  color: string;
  owner: UserSummary | null;
  taskCount: number;
  openTaskCount: number;
  isFavorite: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  key: string;
  number: number;
  projectId: string;
  title: string;
  description: string;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  position: number;
  assignee: UserSummary | null;
  reporter: UserSummary | null;
  sprintId: string | null;
  storyPoints: number | null;
  startDate: string | null;
  dueDate: string | null;
  completedAt: string | null;
  stateId: string;
  state: WorkflowState | null;
  recurrence: Recurrence | null;
  seriesId: string | null;
  parentId: string | null;
  parent: { id: string; key: string; title: string; type: TaskType } | null;
  estimateMinutes: number | null;
  labels: Label[];
  /** Custom field values keyed by field id (select: option id; multi-select: option ids). */
  customFields: Record<string, string | number | boolean | string[]>;
  subtaskCount: number;
  subtaskDone: number;
  blockedBy: number;
  loggedMinutes: number;
  commentCount: number;
  openPrs: number;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface TaskLinkItem {
  id: string;
  type: 'BLOCKS' | 'RELATES' | 'DUPLICATES';
  relation: string;
  direction: 'outgoing' | 'incoming';
  task: { id: string; key: string; title: string; status: TaskStatus; projectId: string };
}

export interface DevLink {
  id: string;
  provider: 'github';
  kind: 'pull_request' | 'commit' | 'issue' | 'branch';
  externalId: string;
  url: string;
  title: string;
  state: 'open' | 'closed' | 'merged' | 'draft' | null;
  author: string | null;
  updatedAt: string;
}

export interface TaskDetail extends Task {
  watchers?: UserSummary[];
  links?: TaskLinkItem[];
  devLinks?: DevLink[];
}

export interface Integration {
  id: string;
  provider: 'slack' | 'github';
  name: string;
  enabled: boolean;
  config: Record<string, any>;
  hookPath: string;
  secret?: string;
  slashCommandEnabled?: boolean;
  lastStatus: string | null;
  lastError: string | null;
  lastActivityAt: string | null;
}

export interface Label {
  id: string;
  name: string;
  color: string;
  description?: string;
  usage?: number;
  openUsage?: number;
}

export interface TimeEntry {
  id: string;
  taskId: string;
  task?: { id: string; key: string; title: string; projectId: string };
  user: UserSummary;
  startedAt: string;
  endedAt: string | null;
  minutes: number | null;
  running: boolean;
  note: string;
}

export type GoalStatus = 'ON_TRACK' | 'AT_RISK' | 'OFF_TRACK' | 'ACHIEVED';
export interface KeyResult {
  id: string;
  title: string;
  kind: 'NUMBER' | 'TASKS';
  startValue: number;
  targetValue: number;
  currentValue: number;
  unit: string;
  progress: number;
}
export interface Goal {
  id: string;
  title: string;
  description: string;
  status: GoalStatus;
  dueDate: string | null;
  owner: UserSummary;
  project: { id: string; key: string; name: string; color: string } | null;
  progress: number;
  keyResults: KeyResult[];
  tasks: { id: string; key: string; title: string; status: TaskStatus }[];
  taskCount: number;
  tasksDone: number;
  updatedAt: string;
}

export interface DocumentSummary {
  id: string;
  title: string;
  icon: string;
  projectId: string | null;
  author: UserSummary;
  updatedBy: UserSummary;
  version: number;
  excerpt: string;
  createdAt: string;
  updatedAt: string;
}
export interface Document extends DocumentSummary {
  content: string;
}

export interface Automation {
  id: string;
  projectId: string;
  name: string;
  enabled: boolean;
  trigger: { event: string; from?: string; to?: string };
  conditions: { type?: string; priority?: string; labelId?: string };
  actions: ({ type: string } & Record<string, any>)[];
  runCount: number;
  lastRunAt: string | null;
}

export interface Webhook {
  id: string;
  name: string;
  url: string;
  events: string[];
  enabled: boolean;
  secret?: string;
  lastDelivery: { success: boolean; statusCode: number | null; at: string } | null;
}

export interface RoadmapItem {
  id: string;
  key: string;
  title: string;
  status: TaskStatus;
  projectId: string;
  projectName: string;
  projectColor: string;
  startDate: string | null;
  dueDate: string | null;
  childCount: number;
  childDone: number;
  points: number;
  progress: number;
  assignee: { id: string; name: string } | null;
}

export interface WorkflowState {
  id: string;
  name: string;
  category: TaskStatus;
  color: string;
  position: number;
  wipLimit: number | null;
  taskCount?: number;
}

export interface Recurrence {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval?: number;
  byWeekday?: number[];
  endDate?: string | null;
}

export interface Board {
  projectId: string;
  columns: { status: TaskStatus; state: WorkflowState; tasks: Task[] }[];
}

export interface Sprint {
  id: string;
  projectId: string;
  name: string;
  goal: string;
  status: SprintStatus;
  startDate: string | null;
  endDate: string | null;
  completedAt: string | null;
  createdAt: string;
  stats: { total: number; done: number; points: number; donePoints: number };
}

export interface Comment {
  id: string;
  taskId: string;
  body: string;
  author: UserSummary;
  createdAt: string;
  updatedAt: string;
  pending?: boolean;
}

export interface Attachment {
  id: string;
  taskId: string;
  fileName: string;
  contentType: string;
  size: number;
  uploader: UserSummary;
  createdAt: string;
  downloadUrl: string;
}

export interface Activity {
  id: string;
  type: string;
  summary: string;
  actor: { id: string | null; name: string };
  projectId: string | null;
  taskId: string | null;
  createdAt: string;
}

export interface Notification {
  id: string;
  type: string;
  /** assigned, mentioned, comments, status, changes, dueSoon, overdue, development, forms, goals, sprints, automation, workspace, security */
  category: string | null;
  title: string;
  body: string;
  actor: { id: string; name: string } | null;
  projectId: string | null;
  taskId: string | null;
  taskKey: string | null;
  /** In-app path for notifications that aren't about a task. */
  link: string | null;
  read: boolean;
  createdAt: string;
}

export interface PushConfig {
  publicKey: string;
  enabled: boolean;
  categories: Record<string, boolean>;
  options: { key: string; label: string; description: string }[];
  devices: { endpoint: string; device: string; createdAt: string; lastSuccessAt: string | null }[];
}

export interface Member {
  user: UserSummary;
  role: Role;
  joinedAt: string;
  twoFactorEnabled?: boolean;
}

export interface Team {
  id: string;
  name: string;
  description: string;
  members: UserSummary[];
}

export interface SearchResults {
  query: string;
  tasks: { id: string; key: string; title: string; status: TaskStatus; priority: TaskPriority; projectId: string; projectName: string }[];
  projects: { id: string; key: string; name: string; color: string }[];
  users: (UserSummary & { role: Role })[];
  comments: { id: string; taskId: string; taskKey: string; projectId: string; snippet: string }[];
  documents: { id: string; title: string; icon: string; projectId: string | null; snippet: string }[];
}

export interface RealtimeEvent<T = any> {
  id: string;
  type: string;
  projectId?: string;
  actor: { id: string; name: string } | null;
  occurredAt: string;
  data: T;
}

export interface EmailCategoryOption {
  key: string;
  label: string;
  description: string;
  default: boolean;
}

export interface EmailPreferences {
  email: string;
  enabled: boolean;
  categories: Record<string, boolean>;
  options: EmailCategoryOption[];
}

export interface EmailDelivery {
  id: string;
  recipient: string;
  category: string;
  subject: string;
  status: 'sent' | 'failed' | 'skipped';
  error: string | null;
  attempts: number;
  createdAt: string;
}

export interface EmailStatus {
  transport: 'smtp' | 'log';
  host: string | null;
  port: number | null;
  secure: boolean;
  requireTls: boolean;
  authenticated: boolean;
  from: string;
  last7Days: { sent: number; failed: number; skipped: number };
  deliveries: EmailDelivery[];
}

export type FieldType = 'TEXT' | 'NUMBER' | 'SELECT' | 'MULTI_SELECT' | 'DATE' | 'CHECKBOX' | 'URL' | 'PERSON';

export interface FieldOption {
  id: string;
  label: string;
  color: string;
}

export interface CustomField {
  id: string;
  projectId: string;
  name: string;
  type: FieldType;
  options: FieldOption[];
  position: number;
  required: boolean;
  showInList: boolean;
}

export interface SavedView {
  id: string;
  projectId: string | null;
  name: string;
  shared: boolean;
  mine: boolean;
  config: { filters?: Record<string, unknown>; cf?: Record<string, unknown>; hiddenFields?: string[] };
  updatedAt: string;
}

export interface TrashedTask {
  id: string;
  key: string;
  title: string;
  type: TaskType;
  status: TaskStatus;
  projectId: string;
  projectKey: string;
  projectName: string;
  deletedAt: string;
  deletedBy: { id: string | null; name: string | null };
  subtaskCount: number;
  purgeAt: string;
}

export interface WorkloadPerson {
  user: UserSummary;
  capacityMinutes: number;
  weeks: { minutes: number; count: number }[];
  unscheduled: { minutes: number; count: number };
  unestimated: number;
  openTasks: number;
  tasks: { id: string; key: string; title: string; projectId: string; priority: TaskPriority; dueDate: string | null; startDate: string | null; minutes: number; overdue: boolean; weeks: number[] }[];
}

export interface Workload {
  from: string;
  weeks: string[];
  people: WorkloadPerson[];
  unassigned: { count: number; minutes: number };
}

export interface Burndown {
  sprintId: string;
  name: string;
  status: string;
  unit: 'points' | 'tasks';
  total: number;
  startDate: string;
  endDate: string;
  days: { date: string; ideal: number; remaining: number | null }[];
}

export interface Velocity {
  unit: 'points' | 'tasks';
  average: number;
  sprints: { id: string; name: string; completedAt: string; committed: number; completed: number }[];
}

export type QuestionKind = 'title' | 'description' | 'email' | 'name' | 'priority' | 'type' | 'dueDate' | 'field';

export interface FormQuestion {
  id: string;
  kind: QuestionKind;
  fieldId?: string;
  label: string;
  help?: string;
  required: boolean;
}

export interface IntakeForm {
  id: string;
  projectId: string;
  slug: string;
  publicPath: string;
  name: string;
  description: string;
  questions: FormQuestion[];
  defaults: { type?: TaskType; priority?: TaskPriority; stateId?: string; assigneeId?: string; labelIds?: string[] };
  enabled: boolean;
  submissionCount: number;
  lastSubmittedAt: string | null;
  createdAt: string;
}

export interface ImportPreview {
  columns: string[];
  mapping: Record<string, string>;
  targets: string[];
  fields: { id: string; name: string; type: FieldType }[];
  total: number;
  valid: number;
  newLabels: string[];
  problems: { row: number; errors: string[]; warnings: string[] }[];
  sample: { row: number; title: string; ok: boolean }[];
  created: number;
  keys?: string[];
  failed?: { row: number; message: string }[];
}
