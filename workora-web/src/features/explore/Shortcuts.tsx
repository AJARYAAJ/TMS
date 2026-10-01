import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUiStore } from '@/app/ui.store';
import { Dialog } from '@/components/ui';

const GO: Record<string, [string, string]> = {
  h: ['/', 'Home'],
  m: ['/my-work', 'My Work'],
  i: ['/inbox', 'Inbox'],
  p: ['/projects', 'Projects'],
  w: ['/workload', 'Workload'],
  r: ['/reports', 'Reports'],
  t: ['/time', 'Timesheet'],
  e: ['/explore', 'Explore'],
  s: ['/settings', 'Settings'],
};

const SHORTCUTS: [string[], string][] = [
  [['Ctrl/⌘', 'K'], 'Command palette — jump anywhere, run anything'],
  [['/'], 'Search'],
  [['C'], 'Create a task'],
  [['?'], 'This cheat sheet'],
  [['Esc'], 'Close the task sheet or dialog'],
  [['Shift', 'click'], 'Select a range of rows in List'],
  ...Object.entries(GO).map(([k, [, name]]) => [['G', k.toUpperCase()], `Go to ${name}`] as [string[], string]),
];

const typing = (el: EventTarget | null) => {
  const e = el as HTMLElement | null;
  return !!e && (e.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.tagName));
};

/** "?" opens the cheat sheet; "G" then a letter navigates (Linear/GitHub style). */
export function ShortcutsLayer() {
  const navigate = useNavigate();
  const open = useUiStore((s) => s.shortcutsOpen);
  const setOpen = useUiStore((s) => s.setShortcuts);
  const pendingG = useRef<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      if (e.key === '?') {
        e.preventDefault();
        setOpen(true);
        return;
      }
      if (pendingG.current !== null) {
        window.clearTimeout(pendingG.current);
        pendingG.current = null;
        const dest = GO[e.key.toLowerCase()];
        if (dest) {
          e.preventDefault();
          navigate(dest[0]);
        }
        return;
      }
      if (e.key === 'g' || e.key === 'G') pendingG.current = window.setTimeout(() => (pendingG.current = null), 1200);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, setOpen]);

  return (
    <Dialog open={open} onClose={() => setOpen(false)} title="Keyboard shortcuts" width={520}>
      <ul className="shortcut-list">
        {SHORTCUTS.map(([keys, what]) => (
          <li key={what}>
            <span className="keys">
              {keys.map((k, i) => (
                <kbd key={k + i}>{k}</kbd>
              ))}
            </span>
            <span>{what}</span>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
