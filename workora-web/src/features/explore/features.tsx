import {
  Bell,
  BookOpen,
  CalendarDays,
  Clock,
  Command,
  Download,
  FileText,
  Filter,
  FolderKanban,
  GanttChart,
  Gauge,
  GitBranch,
  Inbox,
  Kanban,
  Keyboard,
  LayoutGrid,
  List,
  ListChecks,
  Mail,
  Map,
  Rocket,
  Repeat,
  Slack,
  SlidersHorizontal,
  Tag,
  Target,
  TrendingDown,
  Trash2,
  Users,
  Webhook,
  Workflow,
  Zap,
} from 'lucide-react';
import type { ReactNode } from 'react';

export interface Feature {
  id: string;
  name: string;
  blurb: string;
  icon: ReactNode;
  /** Absolute route, or a project sub-route (`project:board`) resolved against the first project. */
  to: string;
  keywords?: string;
  isNew?: boolean;
  role?: 'MEMBER' | 'ADMIN';
}

export interface FeatureGroup {
  title: string;
  tagline: string;
  features: Feature[];
}

/** The catalogue behind Explore, the onboarding checklist and the command palette's "Features" group. */
export const FEATURE_GROUPS: FeatureGroup[] = [
  {
    title: 'Plan',
    tagline: 'Shape the work before it starts',
    features: [
      { id: 'projects', name: 'Projects', blurb: 'Every project has its own key, workflow, fields and views.', icon: <FolderKanban size={18} />, to: '/projects' },
      { id: 'backlog', name: 'Backlog & sprints', blurb: 'Groom the backlog, plan sprints, start and complete them.', icon: <Rocket size={18} />, to: 'project:backlog', keywords: 'scrum iteration' },
      { id: 'roadmap', name: 'Roadmap', blurb: 'Epics across projects on a time axis with progress.', icon: <Map size={18} />, to: '/roadmap', keywords: 'epics gantt' },
      { id: 'timeline', name: 'Timeline', blurb: 'Tasks with start and due dates, drawn as bars.', icon: <GanttChart size={18} />, to: 'project:timeline', keywords: 'gantt' },
      { id: 'goals', name: 'Goals & OKRs', blurb: 'Objectives with key results that roll up from tasks.', icon: <Target size={18} />, to: '/goals', keywords: 'okr objectives' },
      { id: 'workload', name: 'Workload', blurb: "Who has how many hours in which week, against their capacity.", icon: <Gauge size={18} />, to: '/workload', keywords: 'capacity resource planning', isNew: true },
    ],
  },
  {
    title: 'Track',
    tagline: 'See and move the work',
    features: [
      { id: 'board', name: 'Board', blurb: 'Drag cards across your workflow; filter by person, label or priority.', icon: <Kanban size={18} />, to: 'project:board', keywords: 'kanban' },
      { id: 'list', name: 'List & saved views', blurb: 'Filter, sort, bulk-edit and save views you (or your team) reuse.', icon: <List size={18} />, to: 'project:list', keywords: 'table filter bulk', isNew: true },
      { id: 'calendar', name: 'Calendar', blurb: 'Due dates on a month grid.', icon: <CalendarDays size={18} />, to: 'project:calendar' },
      { id: 'fields', name: 'Custom fields', blurb: 'Dropdowns, numbers, dates, people, links… on every task.', icon: <SlidersHorizontal size={18} />, to: 'project:fields', keywords: 'custom properties columns', isNew: true },
      { id: 'labels', name: 'Labels', blurb: 'Workspace-wide tags: describe, recolour, merge and browse.', icon: <Tag size={18} />, to: '/admin', keywords: 'tags', isNew: true },
      { id: 'workflow', name: 'Custom workflows', blurb: 'Your own states and WIP limits per project.', icon: <Workflow size={18} />, to: 'project:workflow', keywords: 'status columns' },
      { id: 'recurring', name: 'Recurring tasks', blurb: 'Daily, weekly, monthly… the next one appears when you finish.', icon: <Repeat size={18} />, to: 'project:list', keywords: 'repeat' },
      { id: 'time', name: 'Time tracking', blurb: 'One-click timers, manual logs and a weekly timesheet.', icon: <Clock size={18} />, to: '/time', keywords: 'timesheet timer' },
      { id: 'my-work', name: 'My Work', blurb: 'Everything assigned to you, grouped by when it is due.', icon: <ListChecks size={18} />, to: '/my-work' },
    ],
  },
  {
    title: 'Collaborate',
    tagline: 'Work together in real time',
    features: [
      { id: 'inbox', name: 'Inbox', blurb: 'Mentions, assignments and updates — live.', icon: <Inbox size={18} />, to: '/inbox', keywords: 'notifications' },
      { id: 'docs', name: 'Docs', blurb: 'Markdown pages per project with live co-editing safety.', icon: <FileText size={18} />, to: '/docs', keywords: 'wiki notes' },
      { id: 'forms', name: 'Intake forms', blurb: 'A public link anyone can fill in; each answer becomes a task.', icon: <BookOpen size={18} />, to: 'project:forms', keywords: 'request form public', isNew: true },
      { id: 'email', name: 'Email notifications', blurb: 'Choose which emails you get; one-click unsubscribe.', icon: <Mail size={18} />, to: '/settings', keywords: 'smtp preferences' },
      { id: 'teams', name: 'Teams', blurb: 'Group people and see who works on what.', icon: <Users size={18} />, to: '/teams' },
      { id: 'notifications', name: 'Watchers & mentions', blurb: 'Watch any task; @mention people in comments.', icon: <Bell size={18} />, to: '/inbox' },
    ],
  },
  {
    title: 'Automate & integrate',
    tagline: 'Let the busywork run itself',
    features: [
      { id: 'automations', name: 'Automations', blurb: 'When → if → then rules per project.', icon: <Zap size={18} />, to: 'project:automations', keywords: 'rules triggers' },
      { id: 'slack', name: 'Slack', blurb: 'Channel updates and the /workora command.', icon: <Slack size={18} />, to: '/admin?tab=integrations', role: 'ADMIN' },
      { id: 'github', name: 'GitHub', blurb: 'PRs and commits linked to tasks; merges move cards.', icon: <GitBranch size={18} />, to: '/admin?tab=integrations', role: 'ADMIN' },
      { id: 'webhooks', name: 'Webhooks', blurb: 'Signed HTTP callbacks for every event.', icon: <Webhook size={18} />, to: '/admin?tab=integrations', role: 'ADMIN' },
      { id: 'csv', name: 'CSV import & export', blurb: 'Bring work in from Jira, Asana or Trello; export any project.', icon: <Download size={18} />, to: 'project:list', keywords: 'migrate spreadsheet excel', isNew: true },
    ],
  },
  {
    title: 'Understand',
    tagline: 'Know where things stand',
    features: [
      { id: 'home', name: 'Home', blurb: 'Your focus task, momentum heatmap and live stream.', icon: <LayoutGrid size={18} />, to: '/' },
      { id: 'reports', name: 'Reports', blurb: 'Status, priority, trends, workload and active sprint.', icon: <Filter size={18} />, to: '/reports' },
      { id: 'burndown', name: 'Burndown & velocity', blurb: "Sprint burndown against the ideal line; committed vs done.", icon: <TrendingDown size={18} />, to: 'project:reports', keywords: 'scrum charts', isNew: true },
      { id: 'trash', name: 'Trash', blurb: 'Deleted tasks are recoverable for 30 days.', icon: <Trash2 size={18} />, to: '/trash', keywords: 'restore undo deleted', isNew: true },
      { id: 'palette', name: 'Command palette', blurb: 'Ctrl/⌘ K — jump anywhere or run any action.', icon: <Command size={18} />, to: '#palette', keywords: 'search shortcut' },
      { id: 'shortcuts', name: 'Keyboard shortcuts', blurb: 'Press ? for the cheat sheet; G then H, M, I, W…', icon: <Keyboard size={18} />, to: '#shortcuts', keywords: 'hotkeys', isNew: true },
    ],
  },
];

export const ALL_FEATURES = FEATURE_GROUPS.flatMap((g) => g.features);

export function resolveFeaturePath(to: string, firstProjectKey?: string) {
  if (!to.startsWith('project:')) return to;
  return firstProjectKey ? `/projects/${firstProjectKey}/${to.slice(8)}` : '/projects';
}
