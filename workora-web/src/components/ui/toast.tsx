import { create } from 'zustand';
import { X } from 'lucide-react';

type Tone = 'info' | 'success' | 'error';
interface Toast {
  id: number;
  message: string;
  tone: Tone;
  action?: { label: string; onClick: () => void };
}

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
}

let seq = 0;
const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (t) => {
    const id = ++seq;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }));
    setTimeout(() => get().dismiss(id), t.tone === 'error' ? 6000 : 4000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  info: (message: string, action?: Toast['action']) => useToastStore.getState().push({ message, tone: 'info', action }),
  success: (message: string) => useToastStore.getState().push({ message, tone: 'success' }),
  error: (message: string) => useToastStore.getState().push({ message, tone: 'error' }),
};

export function Toaster() {
  const { toasts, dismiss } = useToastStore();
  return (
    <div className="toaster" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`}>
          <span>{t.message}</span>
          {t.action && (
            <button className="btn btn-ghost btn-sm" onClick={() => { t.action!.onClick(); dismiss(t.id); }}>
              {t.action.label}
            </button>
          )}
          <button className="icon-btn" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
