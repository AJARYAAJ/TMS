import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { config } from '@/config';
import { LoginPage, RegisterPage, RequireAuth } from '@/features/auth/AuthPages';
import DashboardPage from '@/features/dashboard/DashboardPage';
import { AppShell } from './layouts/AppShell';

// Core (App Shell, auth, dashboard) ships in the initial bundle; everything else is
// code-split and downloaded the first time the user opens it.
const MyWorkPage = lazy(() => import('@/features/my-work/MyWorkPage'));
const ProjectsPage = lazy(() => import('@/features/projects/ProjectsPage'));
const ProjectLayout = lazy(() => import('@/features/projects/ProjectLayout'));
const TeamsPage = lazy(() => import('@/features/teams/TeamsPage'));
const AdminPage = lazy(() => import('@/features/administration/AdminPage'));
const ReportsView = lazy(() => import('@/features/reports/ReportsView'));
const ReportsHub = lazy(() => import('@/features/reports/ReportsView').then((m) => ({ default: m.ReportsHub })));
const views = () => import('@/features/projects/views');
const OverviewView = lazy(() => views().then((m) => ({ default: m.OverviewView })));
const ListView = lazy(() => views().then((m) => ({ default: m.ListView })));
const BoardPage = lazy(() => views().then((m) => ({ default: m.BoardPage })));
const CalendarView = lazy(() => views().then((m) => ({ default: m.CalendarView })));
const TimelineView = lazy(() => views().then((m) => ({ default: m.TimelineView })));
const BacklogView = lazy(() => views().then((m) => ({ default: m.BacklogView })));
const SprintView = lazy(() => views().then((m) => ({ default: m.SprintView })));
const GoalsPage = lazy(() => import('@/features/goals/GoalsPage'));
const DocsPage = lazy(() => import('@/features/docs/DocsPage'));
const RoadmapPage = lazy(() => import('@/features/roadmap/RoadmapPage'));
const TimePage = lazy(() => import('@/features/time/TimePage'));
const InboxPage = lazy(() => import('@/features/inbox/InboxPage'));
const AutomationsView = lazy(() => import('@/features/automations/AutomationsView'));
const WorkflowView = lazy(() => import('@/features/workflow/WorkflowView'));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage'));
const UnsubscribePage = lazy(() => import('@/features/settings/UnsubscribePage'));
const ExplorePage = lazy(() => import('@/features/explore/ExplorePage'));
const WorkloadPage = lazy(() => import('@/features/workload/WorkloadPage'));
const TrashPage = lazy(() => import('@/features/trash/TrashPage'));
const LabelPage = lazy(() => import('@/features/labels/LabelPage'));
const FieldsView = lazy(() => import('@/features/fields/FieldsView'));
const FormsView = lazy(() => import('@/features/forms/FormsView'));
const PublicFormPage = lazy(() => import('@/features/forms/PublicFormPage'));

export const router = createBrowserRouter(
  [
    { path: '/login', element: <LoginPage /> },
    { path: '/register', element: <RegisterPage /> },
    { path: '/unsubscribe', element: <Suspense fallback={null}><UnsubscribePage /></Suspense> },
    { path: '/f/:slug', element: <Suspense fallback={null}><PublicFormPage /></Suspense> },
    {
      path: '/',
      element: (
        <RequireAuth>
          <AppShell />
        </RequireAuth>
      ),
      children: [
        { index: true, element: <DashboardPage /> },
        { path: 'my-work', element: <MyWorkPage /> },
        { path: 'projects', element: <ProjectsPage /> },
        {
          path: 'projects/:projectKey',
          element: <ProjectLayout />,
          children: [
            { index: true, element: <OverviewView /> },
            { path: 'list', element: <ListView /> },
            { path: 'board', element: <BoardPage /> },
            { path: 'calendar', element: <CalendarView /> },
            { path: 'timeline', element: <TimelineView /> },
            { path: 'backlog', element: <BacklogView /> },
            { path: 'sprint', element: <SprintView /> },
            { path: 'roadmap', element: <RoadmapPage /> },
            { path: 'goals', element: <GoalsPage /> },
            { path: 'docs', element: <DocsPage /> },
            { path: 'documents', element: <Navigate to="../docs" replace /> },
            { path: 'reports', element: <ReportsView /> },
            { path: 'automations', element: <AutomationsView /> },
            { path: 'workflow', element: <WorkflowView /> },
            { path: 'fields', element: <FieldsView /> },
            { path: 'forms', element: <FormsView /> },
          ],
        },
        { path: 'teams', element: <TeamsPage /> },
        { path: 'inbox', element: <InboxPage /> },
        { path: 'roadmap', element: <RoadmapPage /> },
        { path: 'goals', element: <GoalsPage /> },
        { path: 'docs', element: <DocsPage /> },
        { path: 'time', element: <TimePage /> },
        { path: 'reports', element: <ReportsHub /> },
        { path: 'admin', element: <AdminPage /> },
        { path: 'settings', element: <SettingsPage /> },
        { path: 'explore', element: <ExplorePage /> },
        { path: 'workload', element: <WorkloadPage /> },
        { path: 'trash', element: <TrashPage /> },
        { path: 'labels/:labelId', element: <LabelPage /> },
        { path: '*', element: <Navigate to="/" replace /> },
      ],
    },
  ],
  { basename: config.appBase },
);
