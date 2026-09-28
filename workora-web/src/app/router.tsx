import { lazy } from 'react';
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
const placeholders = () => import('@/features/placeholders/Placeholders');
const GoalsPage = lazy(() => placeholders().then((m) => ({ default: m.GoalsPage })));
const DocumentsPage = lazy(() => placeholders().then((m) => ({ default: m.DocumentsPage })));

export const router = createBrowserRouter(
  [
    { path: '/login', element: <LoginPage /> },
    { path: '/register', element: <RegisterPage /> },
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
            { path: 'goals', element: <GoalsPage /> },
            { path: 'documents', element: <DocumentsPage /> },
            { path: 'reports', element: <ReportsView /> },
          ],
        },
        { path: 'teams', element: <TeamsPage /> },
        { path: 'goals', element: <GoalsPage /> },
        { path: 'reports', element: <ReportsHub /> },
        { path: 'admin', element: <AdminPage /> },
        { path: '*', element: <Navigate to="/" replace /> },
      ],
    },
  ],
  { basename: config.appBase },
);
