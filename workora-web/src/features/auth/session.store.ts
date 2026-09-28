import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Session } from '@/types';

interface SessionState {
  session: Session | null;
  setSession: (s: Session) => void;
  update: (s: Partial<Session>) => void;
  signOut: () => void;
}

/** Session state: who is signed in, token, current organization and role. */
export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      session: null,
      setSession: (session) => set({ session }),
      update: (partial) => set((s) => (s.session ? { session: { ...s.session, ...partial } } : s)),
      signOut: () => set({ session: null }),
    }),
    { name: 'workora.session' },
  ),
);

export const useSession = () => useSessionStore((s) => s.session);

const RANK = { OWNER: 4, ADMIN: 3, MEMBER: 2, VIEWER: 1 } as const;
export const useCan = (role: keyof typeof RANK) => useSessionStore((s) => !!s.session && RANK[s.session.role] >= RANK[role]);
