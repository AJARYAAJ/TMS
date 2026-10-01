import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TaskStatus } from '@/types';

type Theme = 'light' | 'dark' | 'system';

interface CreateTaskIntent {
  projectId?: string;
  status?: TaskStatus;
  stateId?: string;
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
  shortcutsOpen: boolean;
  setShortcuts: (open: boolean) => void;
  /** Onboarding checklist: dismissed, and steps the user ticked by hand. */
  onboardingHidden: boolean;
  onboardingDone: string[];
  hideOnboarding: (hidden: boolean) => void;
  markOnboarding: (step: string) => void;
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
      shortcutsOpen: false,
      setShortcuts: (shortcutsOpen) => set({ shortcutsOpen, commandPaletteOpen: false }),
      onboardingHidden: false,
      onboardingDone: [],
      hideOnboarding: (onboardingHidden) => set({ onboardingHidden }),
      markOnboarding: (step) => set((s) => (s.onboardingDone.includes(step) ? s : { onboardingDone: [...s.onboardingDone, step] })),
    }),
    {
      name: 'workora.ui',
      partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed, theme: s.theme, onboardingHidden: s.onboardingHidden, onboardingDone: s.onboardingDone }),
    },
  ),
);
