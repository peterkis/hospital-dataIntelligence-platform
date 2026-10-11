import { create } from 'zustand';

type WorkbenchUiState = {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
};

// UI preference only. Records, permissions, requests and route state stay out.
export const useWorkbenchUiStore = create<WorkbenchUiState>((set) => ({
  sidebarCollapsed: typeof window !== 'undefined' && window.matchMedia('(max-width: 1024px)').matches,
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
}));
