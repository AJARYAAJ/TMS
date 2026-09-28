import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TaskStatus } from '@/types';

type Theme = 'light' | 'dark' | 'system';

interface CreateTaskIntent {
  projectId?: string;
  status?: TaskStatus;
  sprintId?: string | null;
}

interface UiState {
  sidebarCollapsed: boolean;
  mobileNavOpen: boolean;
  setMobileNav: (open: boolean) => void;
  theme: Theme;
  commandPaletteOpen: boolean;
  createTask: CreateTaskIntent | null;
  createProjectOpen: boolean;
  toggleSidebar: () => void;
  setTheme: (t: Theme) => void;
  setCommandPalette: (open: boolean) => void;
  openCreateTask: (intent?: CreateTaskIntent) => void;
  closeCreateTask: () => void;
  setCreateProject: (open: boolean) => void;
}

/** Pure UI state — never mixed with server data (that lives in the query cache). */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      mobileNavOpen: false,
      setMobileNav: (mobileNavOpen) => set({ mobileNavOpen }),
      theme: 'system',
      commandPaletteOpen: false,
      createTask: null,
      createProjectOpen: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setTheme: (theme) => set({ theme }),
      setCommandPalette: (commandPaletteOpen) => set({ commandPaletteOpen }),
      openCreateTask: (intent = {}) => set({ createTask: intent, commandPaletteOpen: false }),
      closeCreateTask: () => set({ createTask: null }),
      setCreateProject: (createProjectOpen) => set({ createProjectOpen, commandPaletteOpen: false }),
    }),
    { name: 'workora.ui', partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed, theme: s.theme }) },
  ),
);
