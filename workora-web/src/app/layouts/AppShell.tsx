import { BarChart3, Building2, Check, ChevronDown, FolderKanban, Home, LayoutDashboard, LogOut, Monitor, Moon, PanelLeft, Plus, Settings, Sun, Target, Users } from 'lucide-react';
import { Suspense, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Avatar, Skeleton } from '@/components/ui';
import { useSignOut, useSwitchOrganization } from '@/features/auth/api';
import { useCan, useSession } from '@/features/auth/session.store';
import { CommandPalette } from '@/features/command-palette/CommandPalette';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { CreateProjectDialog } from '@/features/projects/CreateProjectDialog';
import { useProjects } from '@/features/projects/api';
import { GlobalSearch } from '@/features/search/GlobalSearch';
import { CreateTaskDialog } from '@/features/tasks/CreateTaskDialog';
import { TaskDrawer } from '@/features/tasks/TaskDrawer';
import { useHotkey } from '@/hooks/useHotkey';
import { useRealtimeConnection, useRealtimeStatus } from '@/services/websocket/useRealtime';
import { useUiStore } from '../ui.store';

function Sidebar() {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const mobileOpen = useUiStore((s) => s.mobileNavOpen);
  const { data: projects, isLoading } = useProjects();
  const canAdmin = useCan('ADMIN');
  const canCreate = useCan('MEMBER');
  const setCreateProject = useUiStore((s) => s.setCreateProject);

  const item = (to: string, icon: React.ReactNode, label: string, end = false) => (
    <NavLink to={to} end={end} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`} title={label}>
      {icon}
      <span className="nav-label">{label}</span>
    </NavLink>
  );

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}${mobileOpen ? ' mobile-open' : ''}`}>
      <div className="brand">
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={24} height={24} />
        <span className="nav-label">Workora</span>
      </div>
      <nav className="nav">
        {item('/', <LayoutDashboard size={17} />, 'Dashboard', true)}
        {item('/my-work', <Home size={17} />, 'My Work')}
        {item('/projects', <FolderKanban size={17} />, 'Projects', true)}
        {item('/teams', <Users size={17} />, 'Teams')}
        {item('/goals', <Target size={17} />, 'Goals')}
        {item('/reports', <BarChart3 size={17} />, 'Reports')}
        {canAdmin && item('/admin', <Settings size={17} />, 'Administration')}
      </nav>
      <div className="nav-section">
        <span className="nav-section-title nav-label">Projects</span>
        {canCreate && (
          <button className="icon-btn nav-label" title="New project" onClick={() => setCreateProject(true)}>
            <Plus size={14} />
          </button>
        )}
      </div>
      <nav className="nav nav-projects">
        {isLoading && Array.from({ length: 3 }, (_, i) => <Skeleton key={i} height={26} style={{ margin: '4px 10px', width: 'auto' }} />)}
        {projects
          ?.filter((p) => p.status === 'ACTIVE')
          .map((p) => (
            <NavLink key={p.id} to={`/projects/${p.key}`} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`} title={p.name}>
              <span className="project-dot" style={{ background: p.color }} />
              <span className="nav-label">{p.name}</span>
            </NavLink>
          ))}
      </nav>
    </aside>
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

function UserMenu() {
  const session = useSession()!;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const signOut = useSignOut();
  const switchOrg = useSwitchOrganization();
  const { theme, setTheme } = useUiStore();
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div className="menu-anchor" ref={ref}>
      <button className="user-button" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} aria-label="User menu">
        <Avatar user={session.user} size={28} />
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-header">
            <strong>{session.user.name}</strong>
            <span className="muted small">{session.user.email}</span>
            <span className="badge">{session.role.toLowerCase()}</span>
          </div>
          <div className="menu-label">Workspaces</div>
          {session.organizations.map((o) => (
            <button key={o.id} className="menu-item" role="menuitem" onClick={() => o.id !== session.organization.id && switchOrg.mutate(o.id)}>
              <Building2 size={14} /> {o.name}
              {o.id === session.organization.id && <Check size={14} className="ml-auto" />}
            </button>
          ))}
          <div className="menu-label">Theme</div>
          <div className="segmented">
            {(['light', 'dark', 'system'] as const).map((t) => (
              <button key={t} className={theme === t ? 'active' : ''} onClick={() => setTheme(t)} title={t} aria-label={`${t} theme`}>
                {t === 'light' ? <Sun size={14} /> : t === 'dark' ? <Moon size={14} /> : <Monitor size={14} />}
              </button>
            ))}
          </div>
          <div className="menu-divider" />
          <button className="menu-item" role="menuitem" onClick={signOut}>
            <LogOut size={14} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function RealtimeIndicator() {
  const status = useRealtimeStatus();
  const label = status === 'online' ? 'Live' : status === 'connecting' ? 'Connecting…' : 'Offline';
  return <span className={`live-dot live-${status}`} title={`Realtime: ${label}`} aria-label={`Realtime ${label}`} />;
}

export function AppShell() {
  useRealtimeConnection();
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const { mobileNavOpen, setMobileNav } = useUiStore();
  const setPalette = useUiStore((s) => s.setCommandPalette);
  const openCreateTask = useUiStore((s) => s.openCreateTask);
  const canCreate = useCan('MEMBER');
  const location = useLocation();
  const projectKey = location.pathname.match(/^\/projects\/([^/]+)/)?.[1];
  useEffect(() => setMobileNav(false), [location.pathname, setMobileNav]);
  const onToggleNav = () => (window.matchMedia('(max-width: 700px)').matches ? setMobileNav(!mobileNavOpen) : toggleSidebar());

  useHotkey('mod+k', () => setPalette(true));
  useHotkey('c', () => canCreate && openCreateTask({ projectId: projectKey }));

  return (
    <div className="app">
      <ThemeEffect />
      <Sidebar />
      {mobileNavOpen && <div className="nav-backdrop" onClick={() => setMobileNav(false)} />}
      <div className="main">
        <header className="header">
          <button className="icon-btn" onClick={onToggleNav} aria-label="Toggle navigation">
            <PanelLeft size={18} />
          </button>
          <GlobalSearch />
          <button className="kbd-hint" onClick={() => setPalette(true)} title="Command palette">
            <kbd>Ctrl</kbd>
            <kbd>K</kbd>
          </button>
          <div className="header-actions">
            {canCreate && (
              <button className="btn btn-primary btn-sm" onClick={() => openCreateTask({ projectId: projectKey })}>
                <Plus size={14} /> Create
              </button>
            )}
            <RealtimeIndicator />
            <NotificationBell />
            <UserMenu />
          </div>
        </header>
        <main className="content">
          <Suspense fallback={<PageSkeleton />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      <TaskDrawer />
      <CommandPalette />
      <CreateTaskDialog />
      <CreateProjectDialog />
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="page" aria-busy="true">
      <Skeleton width={220} height={26} />
      <div style={{ display: 'flex', gap: 12, margin: '20px 0' }}>
        <Skeleton width={120} height={30} />
        <Skeleton width={120} height={30} />
        <Skeleton width={120} height={30} />
      </div>
      <Skeleton height={16} width="70%" />
      <Skeleton height={16} width="55%" style={{ marginTop: 10 }} />
      <Skeleton height={16} width="62%" style={{ marginTop: 10 }} />
    </div>
  );
}
