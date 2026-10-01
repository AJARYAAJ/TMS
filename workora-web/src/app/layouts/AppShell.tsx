import {
  BarChart3,
  Building2,
  Check,
  ChevronDown,
  Clock,
  FileText,
  FolderKanban,
  Home,
  Inbox,
  LogOut,
  Map,
  Monitor,
  Moon,
  Plus,
  Settings,
  Settings2,
  Compass,
  Gauge,
  Keyboard,
  Trash2,
  Square,
  Sun,
  Target,
  Users,
  Zap,
} from 'lucide-react';
import { Suspense, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Avatar, Skeleton } from '@/components/ui';
import { useSignOut, useSwitchOrganization } from '@/features/auth/api';
import { useCan, useSession } from '@/features/auth/session.store';
import { CommandPalette } from '@/features/command-palette/CommandPalette';
import { ShortcutsLayer } from '@/features/explore/Shortcuts';
import { useNotifications } from '@/features/notifications/api';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { CreateProjectDialog } from '@/features/projects/CreateProjectDialog';
import { useProjects } from '@/features/projects/api';
import { GlobalSearch } from '@/features/search/GlobalSearch';
import { useRunningTimer, useTimer } from '@/features/tasks/api';
import { CreateTaskDialog } from '@/features/tasks/CreateTaskDialog';
import { TaskDrawer } from '@/features/tasks/TaskDrawer';
import { useOpenTask } from '@/features/tasks/useOpenTask';
import { useHotkey } from '@/hooks/useHotkey';
import { useRealtimeConnection, useRealtimeStatus } from '@/services/websocket/useRealtime';
import { useUiStore } from '../ui.store';

/** Floating icon dock: primary navigation + favourite projects as "app icons". */
function Dock() {
  const { data: projects } = useProjects();
  const { data: notifications } = useNotifications();
  const canAdmin = useCan('ADMIN');
  const unread = notifications?.meta.unreadCount ?? 0;
  const favorites = projects?.filter((p) => p.isFavorite && p.status === 'ACTIVE') ?? [];

  const item = (to: string, icon: React.ReactNode, label: string, end = false, badge?: number) => (
    <NavLink to={to} end={end} className={({ isActive }) => `dock-item${isActive ? ' active' : ''}`} aria-label={label} data-tip={label}>
      {icon}
      {!!badge && <span className="dock-badge">{badge > 9 ? '9+' : badge}</span>}
      <span className="dock-label">{label}</span>
    </NavLink>
  );

  return (
    <nav className="dock" aria-label="Main">
      <NavLink to="/" className="dock-logo" aria-label="Workora home">
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={30} height={30} />
      </NavLink>
      <div className="dock-group">
        {item('/', <Home size={19} />, 'Home', true)}
        {item('/my-work', <Zap size={19} />, 'My Work')}
        {item('/inbox', <Inbox size={19} />, 'Inbox', false, unread)}
        {item('/projects', <FolderKanban size={19} />, 'Projects', true)}
        {item('/roadmap', <Map size={19} />, 'Roadmap')}
        {item('/goals', <Target size={19} />, 'Goals')}
        {item('/docs', <FileText size={19} />, 'Docs')}
        {item('/workload', <Gauge size={19} />, 'Workload')}
        {item('/time', <Clock size={19} />, 'Time')}
        {item('/reports', <BarChart3 size={19} />, 'Reports')}
        {item('/teams', <Users size={19} />, 'Teams')}
        {canAdmin && item('/admin', <Settings size={19} />, 'Admin')}
        {item('/explore', <Compass size={19} />, 'Explore')}
      </div>
      {favorites.length > 0 && (
        <div className="dock-group dock-projects">
          {favorites.slice(0, 6).map((p) => (
            <NavLink key={p.id} to={`/projects/${p.key}/board`} className={({ isActive }) => `dock-app${isActive ? ' active' : ''}`} style={{ ['--app' as any]: p.color }} aria-label={p.name} data-tip={p.name}>
              {p.key.slice(0, 2)}
            </NavLink>
          ))}
        </div>
      )}
    </nav>
  );
}

function ThemeEffect() {
  const theme = useUiStore((s) => s.theme);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }, [theme]);
  return null;
}

function useClickOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, close]);
  return ref;
}

function WorkspaceSwitcher() {
  const session = useSession()!;
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(open, () => setOpen(false));
  const switchOrg = useSwitchOrganization();
  const setCreateProject = useUiStore((s) => s.setCreateProject);
  const canCreate = useCan('MEMBER');
  return (
    <div className="menu-anchor" ref={ref}>
      <button className="workspace" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}>
        <span className="workspace-mark">{session.organization.name.slice(0, 1)}</span>
        <span className="workspace-name">{session.organization.name}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="popover menu" role="menu">
          <div className="menu-label">Workspaces</div>
          {session.organizations.map((o) => (
            <button key={o.id} className="menu-item" role="menuitem" onClick={() => (o.id !== session.organization.id ? switchOrg.mutate(o.id) : setOpen(false))}>
              <Building2 size={14} /> {o.name}
              {o.id === session.organization.id && <Check size={14} className="ml-auto" />}
            </button>
          ))}
          {canCreate && (
            <>
              <div className="menu-divider" />
              <button
                className="menu-item"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  setCreateProject(true);
                }}
              >
                <Plus size={14} /> New project
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const session = useSession()!;
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(open, () => setOpen(false));
  const signOut = useSignOut();
  const { theme, setTheme } = useUiStore();
  return (
    <div className="menu-anchor" ref={ref}>
      <button className="user-button" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} aria-label="User menu">
        <Avatar user={session.user} size={30} />
      </button>
      {open && (
        <div className="popover menu right" role="menu">
          <div className="menu-header">
            <Avatar user={session.user} size={36} />
            <div>
              <strong>{session.user.name}</strong>
              <div className="muted small">{session.user.email}</div>
            </div>
            <span className="pill pill-soft ml-auto">{session.role.toLowerCase()}</span>
          </div>
          <div className="menu-label">Appearance</div>
          <div className="seg seg-block">
            {(['light', 'dark', 'system'] as const).map((t) => (
              <button key={t} className={theme === t ? 'active' : ''} onClick={() => setTheme(t)} aria-label={`${t} theme`}>
                {t === 'light' ? <Sun size={14} /> : t === 'dark' ? <Moon size={14} /> : <Monitor size={14} />} {t}
              </button>
            ))}
          </div>
          <div className="menu-divider" />
          <Link className="menu-item" role="menuitem" to="/settings" onClick={() => setOpen(false)}>
            <Settings2 size={14} /> Notification settings
          </Link>
          <Link className="menu-item" role="menuitem" to="/trash" onClick={() => setOpen(false)}>
            <Trash2 size={14} /> Trash
          </Link>
          <button className="menu-item" role="menuitem" onClick={() => { setOpen(false); useUiStore.getState().setShortcuts(true); }}>
            <Keyboard size={14} /> Keyboard shortcuts <kbd className="ml-auto">?</kbd>
          </button>
          <button className="menu-item" role="menuitem" onClick={signOut}>
            <LogOut size={14} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/** Live timer in the command bar: ticks every second, click the key to open the task. */
function TimerChip() {
  const { data: timer } = useRunningTimer();
  const { stop } = useTimer();
  const openTask = useOpenTask();
  const [, tick] = useState(0);
  useEffect(() => {
    if (!timer) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [timer]);
  if (!timer) return null;
  const secs = Math.floor((Date.now() - new Date(timer.startedAt).getTime()) / 1000);
  const hh = Math.floor(secs / 3600);
  const mm = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');
  return (
    <div className="timer-chip" role="timer" aria-label={`Timer running on ${timer.task?.key}`}>
      <span className="timer-pulse" />
      <button className="timer-task" onClick={() => timer.task && openTask(timer.task.key)} title={timer.task?.title}>
        {timer.task?.key}
      </button>
      <span className="timer-time">{hh ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`}</span>
      <button className="timer-stop" onClick={() => stop.mutate()} aria-label="Stop timer" disabled={stop.isPending}>
        <Square size={11} fill="currentColor" />
      </button>
    </div>
  );
}

function RealtimeIndicator() {
  const status = useRealtimeStatus();
  const label = status === 'online' ? 'Live' : status === 'connecting' ? 'Connecting…' : 'Offline';
  return (
    <span className={`live live-${status}`} title={`Realtime: ${label}`} aria-label={`Realtime ${label}`}>
      <span className="live-dot" />
      <span className="live-text">{status === 'online' ? 'Live' : label}</span>
    </span>
  );
}

export function AppShell() {
  useRealtimeConnection();
  const setPalette = useUiStore((s) => s.setCommandPalette);
  const openCreateTask = useUiStore((s) => s.openCreateTask);
  const canCreate = useCan('MEMBER');
  const location = useLocation();
  const projectKey = location.pathname.match(/^\/projects\/([^/]+)/)?.[1];
  const canvas = useRef<HTMLElement>(null);

  useHotkey('mod+k', () => setPalette(true));
  useHotkey('c', () => canCreate && openCreateTask({ projectId: projectKey }));
  useEffect(() => canvas.current?.scrollTo({ top: 0 }), [location.pathname]);

  return (
    <div className="app">
      <ThemeEffect />
      <Dock />
      <div className="stage">
        <header className="island">
          <WorkspaceSwitcher />
          <GlobalSearch />
          <button className="kbd-hint" onClick={() => setPalette(true)} title="Command palette" aria-label="Open command palette">
            <kbd>Ctrl</kbd>
            <kbd>K</kbd>
          </button>
          <div className="island-right">
            <TimerChip />
            <RealtimeIndicator />
            {canCreate && (
              <button className="btn btn-volt btn-sm create-btn" onClick={() => openCreateTask({ projectId: projectKey })}>
                <Plus size={15} strokeWidth={2.5} /> <span>Create</span>
              </button>
            )}
            <NotificationBell />
            <UserMenu />
          </div>
        </header>
        <main className="canvas" ref={canvas}>
          <Suspense fallback={<PageSkeleton />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      <TaskDrawer />
      <CommandPalette />
      <ShortcutsLayer />
      <CreateTaskDialog />
      <CreateProjectDialog />
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="page" aria-busy="true">
      <Skeleton width={120} height={12} />
      <Skeleton width={320} height={40} style={{ marginTop: 10 }} />
      <div className="bento" style={{ marginTop: 28 }}>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="tile">
            <Skeleton width="50%" />
            <Skeleton width="30%" height={34} style={{ marginTop: 16 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
