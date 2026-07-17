import { create } from "zustand";

type ThemeMode = "light" | "dark" | "system";

type UiState = {
  isMobileNavOpen: boolean;
  themeMode: ThemeMode;
  closeMobileNav: () => void;
  openMobileNav: () => void;
  setThemeMode: (themeMode: ThemeMode) => void;
  toggleMobileNav: () => void;
};

export const useUiStore = create<UiState>((set) => ({
  isMobileNavOpen: false,
  themeMode: "system",
  closeMobileNav: () => set({ isMobileNavOpen: false }),
  openMobileNav: () => set({ isMobileNavOpen: true }),
  setThemeMode: (themeMode) => set({ themeMode }),
  toggleMobileNav: () =>
    set((state) => ({ isMobileNavOpen: !state.isMobileNavOpen })),
}));
