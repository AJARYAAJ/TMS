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
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface Board {
  projectId: string;
  columns: { status: TaskStatus; tasks: Task[] }[];
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
}

export interface RealtimeEvent<T = any> {
  id: string;
  type: string;
  projectId?: string;
  actor: { id: string; name: string } | null;
  occurredAt: string;
  data: T;
}
