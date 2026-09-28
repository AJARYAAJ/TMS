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
  usage?: number;
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
  title: string;
  body: string;
  actor: { id: string; name: string } | null;
  projectId: string | null;
  taskId: string | null;
  taskKey: string | null;
  read: boolean;
  createdAt: string;
}

export interface Member {
  user: UserSummary;
  role: Role;
  joinedAt: string;
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
