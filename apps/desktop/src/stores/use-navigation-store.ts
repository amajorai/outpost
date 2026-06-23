import { load } from "@tauri-apps/plugin-store";
import { create } from "zustand";
import { logger } from "@/lib/logger";

const NAVIGATION_STORE_NAME = "navigation.json";
const ACTIVE_SECTION_FIELD = "active_section";

export type NavSection =
  | "war-room"
  | "compose"
  | "repurpose"
  | "calendar"
  | "inbox"
  | "activity"
  | "experiments"
  | "autoresearch"
  | "autopilot"
  | "radar"
  | "money"
  | "templates"
  | "settings";

export const NAV_SECTIONS: NavSection[] = [
  "war-room",
  "compose",
  "repurpose",
  "calendar",
  "inbox",
  "activity",
  "experiments",
  "autoresearch",
  "autopilot",
  "radar",
  "money",
  "templates",
  "settings",
];

const DEFAULT_SECTION: NavSection = "war-room";

function isNavSection(value: unknown): value is NavSection {
  return (
    typeof value === "string" && NAV_SECTIONS.includes(value as NavSection)
  );
}

interface NavigationState {
  activeSection: NavSection;
  isInitialLoadDone: boolean;
  setActiveSection: (section: NavSection) => Promise<void>;
  loadNavigation: () => Promise<void>;
}

export const useNavigationStore = create<NavigationState>()((set) => ({
  activeSection: DEFAULT_SECTION,
  isInitialLoadDone: false,

  setActiveSection: async (section: NavSection) => {
    // Update UI immediately, then persist.
    set({ activeSection: section });
    try {
      const store = await load(NAVIGATION_STORE_NAME, {
        defaults: {},
        autoSave: true,
      });
      await store.set(ACTIVE_SECTION_FIELD, section);
      await store.save();
    } catch (error) {
      logger.error(
        { err: error },
        "[Navigation] Failed to persist active section"
      );
    }
  },

  loadNavigation: async () => {
    try {
      const store = await load(NAVIGATION_STORE_NAME, {
        defaults: {},
        autoSave: false,
      });
      const stored = await store.get<unknown>(ACTIVE_SECTION_FIELD);
      set({
        activeSection: isNavSection(stored) ? stored : DEFAULT_SECTION,
        isInitialLoadDone: true,
      });
    } catch (error) {
      logger.error({ err: error }, "[Navigation] Failed to load navigation");
      set({ isInitialLoadDone: true });
    }
  },
}));
