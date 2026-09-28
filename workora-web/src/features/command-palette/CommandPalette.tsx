import { BarChart3, Building2, FolderKanban, FolderPlus, Home, LayoutDashboard, ListTodo, Moon, Play, Plus, Search, Settings, Sun } from 'lucide-react';
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useUiStore } from '@/app/ui.store';
import { Spinner, StatusBadge } from '@/components/ui';
import { useSwitchOrganization } from '@/features/auth/api';
import { useCan, useSession } from '@/features/auth/session.store';
import { useProjects } from '@/features/projects/api';
import { useSearch } from '@/features/search/api';
import { useOpenTask } from '@/features/tasks/useOpenTask';

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  group: string;
  keywords?: string;
  run: () => void;
}

/** Ctrl/⌘ + K: jump anywhere or run an action without touching the mouse. */
export function CommandPalette() {
  const open = useUiStore((s) => s.commandPaletteOpen);
  const setOpen = useUiStore((s) => s.setCommandPalette);
  if (!open) return null;
  return <PaletteBody onClose={() => setOpen(false)} />;
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const openTask = useOpenTask();
  const session = useSession()!;
  const canCreate = useCan('MEMBER');
  const canAdmin = useCan('ADMIN');
  const { openCreateTask, setCreateProject, theme, setTheme } = useUiStore();
  const switchOrg = useSwitchOrganization();
  const { data: projects } = useProjects();
  const { data: results, isFetching } = useSearch(q);
  const currentProject = location.pathname.match(/^\/projects\/([^/]+)/)?.[1];

  const go = (path: string) => () => navigate(path);
  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [];
    if (canCreate) {
      list.push({ id: 'create-task', label: 'Create Task', hint: 'C', icon: <Plus size={16} />, group: 'Actions', run: () => openCreateTask({ projectId: currentProject }) });
      list.push({ id: 'create-project', label: 'Create Project', icon: <FolderPlus size={16} />, group: 'Actions', run: () => setCreateProject(true) });
    }
    list.push(
      { id: 'search-tasks', label: 'Search Tasks', hint: '/', icon: <Search size={16} />, group: 'Actions', run: () => setTimeout(() => document.querySelector<HTMLInputElement>('.global-search input')?.focus(), 0) },
      { id: 'my-work', label: 'Open My Work', icon: <Home size={16} />, group: 'Navigate', run: go('/my-work') },
      { id: 'dashboard', label: 'Open Dashboard', icon: <LayoutDashboard size={16} />, group: 'Navigate', run: go('/') },
      { id: 'projects', label: 'Open Projects', icon: <FolderKanban size={16} />, group: 'Navigate', run: go('/projects') },
      { id: 'reports', label: 'Open Reports', icon: <BarChart3 size={16} />, group: 'Navigate', run: go(currentProject ? `/projects/${currentProject}/reports` : '/reports') },
    );
    if (canCreate) {
      list.push({
        id: 'start-sprint',
        label: 'Start Sprint',
        hint: currentProject ? `in ${currentProject}` : 'pick a project',
        icon: <Play size={16} />,
        group: 'Actions',
        run: go(currentProject ? `/projects/${currentProject}/backlog` : '/projects'),
      });
    }
    if (canAdmin) list.push({ id: 'admin', label: 'Open Administration', icon: <Settings size={16} />, group: 'Navigate', run: go('/admin') });
    list.push({
      id: 'theme',
      label: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
      icon: theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />,
      group: 'Preferences',
      run: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
    });
    for (const o of session.organizations) {
      if (o.id !== session.organization.id) {
        list.push({ id: `org-${o.id}`, label: `Switch Workspace: ${o.name}`, icon: <Building2 size={16} />, group: 'Workspaces', keywords: 'switch workspace organization', run: () => switchOrg.mutate(o.id) });
      }
    }
    for (const p of projects ?? []) {
      list.push({ id: `p-${p.id}`, label: p.name, hint: p.key, icon: <FolderKanban size={16} style={{ color: p.color }} />, group: 'Projects', keywords: `${p.key} project`, run: go(`/projects/${p.key}/board`) });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCreate, canAdmin, currentProject, projects, session, theme]);

  const needle = q.trim().toLowerCase();
  const filtered = needle ? commands.filter((c) => `${c.label} ${c.hint ?? ''} ${c.keywords ?? ''}`.toLowerCase().includes(needle)) : commands.filter((c) => c.group !== 'Projects' || commands.indexOf(c) < 12);
  const taskHits: Command[] =
    needle.length >= 2
      ? (results?.tasks ?? []).map((t) => ({ id: `t-${t.id}`, label: `${t.key} ${t.title}`, icon: <ListTodo size={16} />, group: 'Tasks', hint: t.status, run: () => openTask(t.key) }))
      : [];
  const items = [...filtered, ...taskHits];

  useEffect(() => setActive(0), [q, results]);
  useEffect(() => {
    listRef.current?.querySelector('.palette-item.active')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const run = (c: Command) => {
    onClose();
    c.run();
  };

  let lastGroup = '';
  return (
    <div className="overlay palette-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label="Command palette">
        <div className="palette-input">
          <Search size={18} />
          <input
            autoFocus
            value={q}
            placeholder="Search or run command…"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, items.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === 'Enter' && items[active]) run(items[active]);
            }}
          />
          {isFetching && <Spinner size={12} />}
          <kbd>Esc</kbd>
        </div>
        <div className="palette-list" ref={listRef} role="listbox">
          {items.length === 0 && <p className="muted small search-empty">No matching commands</p>}
          {items.map((c, i) => {
            const header = c.group !== lastGroup ? <div className="search-group">{c.group}</div> : null;
            lastGroup = c.group;
            return (
              <div key={c.id}>
                {header}
                <button className={`palette-item${i === active ? ' active' : ''}`} onMouseEnter={() => setActive(i)} onClick={() => run(c)} role="option" aria-selected={i === active}>
                  {c.icon}
                  <span className="ellipsis">{c.label}</span>
                  {c.group === 'Tasks' && c.hint ? <StatusBadge status={c.hint as any} /> : c.hint && <span className="muted small ml-auto">{c.hint}</span>}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
