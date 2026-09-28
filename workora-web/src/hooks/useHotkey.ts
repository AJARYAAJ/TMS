import { useEffect } from 'react';

/** Registers a global shortcut such as "mod+k" (Ctrl on Windows/Linux, ⌘ on macOS). */
export function useHotkey(combo: string, handler: (e: KeyboardEvent) => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const parts = combo.toLowerCase().split('+');
    const key = parts[parts.length - 1];
    const needsMod = parts.includes('mod');
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== key) return;
      if (needsMod !== (e.metaKey || e.ctrlKey)) return;
      if (!needsMod) {
        const el = e.target as HTMLElement;
        if (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      }
      e.preventDefault();
      handler(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [combo, handler, enabled]);
}
