import { Check, Search } from 'lucide-react';
import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface PickerOption<V extends string = string> {
  value: V;
  label: string;
  icon?: ReactNode;
  hint?: string;
}

interface Props<V extends string> {
  /** Current value(s). Pass an array for multi-select. */
  value: V | V[] | null;
  options: PickerOption<V>[];
  onChange: (value: V | null, all?: V[]) => void;
  children: ReactNode;
  label: string;
  disabled?: boolean;
  searchable?: boolean;
  clearLabel?: string;
  footer?: (close: () => void, query: string) => ReactNode;
  align?: 'left' | 'right';
  className?: string;
}

/**
 * Pill-style trigger that opens a floating, keyboard-navigable option list.
 * Replaces native <select>s for task properties so edits feel inline and instant.
 */
export function Picker<V extends string>({ value, options, onChange, children, label, disabled, searchable, clearLabel, footer, align = 'left', className }: Props<V>) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [flip, setFlip] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const multi = Array.isArray(value);
  const selected = new Set(multi ? value : value ? [value] : []);

  const items: (PickerOption<V> | { value: null; label: string })[] = [
    ...(clearLabel ? [{ value: null, label: clearLabel }] : []),
    ...options.filter((o) => !q || `${o.label} ${o.hint ?? ''}`.toLowerCase().includes(q.toLowerCase())),
  ];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  useLayoutEffect(() => {
    if (!open || !pop.current) return;
    const r = pop.current.getBoundingClientRect();
    setFlip(r.bottom > window.innerHeight - 8 && r.height < r.top);
  }, [open]);
  useEffect(() => {
    setActive(0);
  }, [q, open]);

  const choose = (v: V | null) => {
    if (multi) {
      const next = new Set(selected);
      if (v !== null) (next.has(v) ? next.delete(v) : next.add(v));
      else next.clear();
      onChange(v, [...next]);
    } else {
      onChange(v);
      setOpen(false);
    }
  };

  return (
    <div className={`picker ${className ?? ''}`} ref={ref}>
      <button
        type="button"
        className="picker-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => {
          setOpen(!open);
          setQ('');
        }}
      >
        {children}
      </button>
      {open && (
        <div
          ref={pop}
          className={`popover picker-pop ${align === 'right' ? 'right' : ''} ${flip ? 'flip' : ''}`}
          role="listbox"
          aria-label={label}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setOpen(false);
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, items.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter' && items[active]) {
              e.preventDefault();
              choose(items[active].value as V | null);
            }
          }}
        >
          {(searchable || options.length > 8) && (
            <div className="picker-search">
              <Search size={14} />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${label.toLowerCase()}…`} aria-label={`Search ${label}`} />
            </div>
          )}
          {!(searchable || options.length > 8) && <input className="sr-focus" autoFocus aria-hidden readOnly />}
          <div className="picker-list">
            {items.map((o, i) => (
              <button
                type="button"
                key={o.value ?? '__clear'}
                role="option"
                aria-selected={o.value !== null && selected.has(o.value as V)}
                className={`picker-item${i === active ? ' active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(o.value as V | null)}
              >
                {'icon' in o && o.icon}
                <span className="ellipsis">{o.label}</span>
                {'hint' in o && o.hint && <span className="muted small">{o.hint}</span>}
                {o.value !== null && selected.has(o.value as V) && <Check size={14} className="ml-auto" />}
              </button>
            ))}
            {items.length === 0 && <div className="muted small picker-empty">No matches</div>}
          </div>
          {footer?.(() => setOpen(false), q)}
        </div>
      )}
    </div>
  );
}
