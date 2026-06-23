/**
 * Store for the active workspace and workspace management (U32).
 *
 * Holds the list of workspaces plus the id of the one the user is currently
 * viewing. The active id is persisted (tauri-plugin-store) and defaults to
 * {@link DEFAULT_WORKSPACE_ID}. On every change — including the initial load — it
 * is mirrored into `lib/current-workspace` so the repos (which read that module
 * synchronously as their default scope) re-scope to the active workspace.
 *
 * Switching the active workspace must also re-query already-mounted data views.
 * That reactivity lives in the shell: `app-shell` keys the main content on the
 * active id, so a switch remounts the panels and re-runs their load effects.
 * This store only owns the id + the persisted value.
 */

import { load } from "@tauri-apps/plugin-store";
import { create } from "zustand";
import { setCurrentWorkspaceId } from "@/lib/current-workspace";
import { logger } from "@/lib/logger";
import {
  countWorkspaces,
  createWorkspace as createWorkspaceRow,
  deleteWorkspace as deleteWorkspaceRow,
  ensureDefaultWorkspace,
  listWorkspaces,
  renameWorkspace as renameWorkspaceRow,
} from "@/lib/repos/workspaces";
import { DEFAULT_WORKSPACE_ID, type Workspace } from "@/lib/social-schema";

const WORKSPACE_STORE_NAME = "workspace.json";
const ACTIVE_WORKSPACE_FIELD = "active_workspace_id";

interface WorkspaceState {
  workspaces: Workspace[];
  activeWorkspaceId: string;
  isInitialLoadDone: boolean;

  /** Load the workspace list + persisted active id, then mirror it to the seam. */
  loadWorkspaces: () => Promise<void>;
  /** Switch the active workspace and persist the choice. */
  setActiveWorkspace: (id: string) => Promise<void>;
  /** Create a workspace and switch to it. Returns the new workspace. */
  createWorkspace: (name: string) => Promise<Workspace>;
  /** Rename a workspace in place. */
  renameWorkspace: (id: string, name: string) => Promise<void>;
  /**
   * Delete a workspace and all its data. Refuses the last workspace. If the
   * deleted workspace was active, switches to another remaining one.
   */
  deleteWorkspace: (id: string) => Promise<void>;
}

async function persistActiveWorkspace(id: string): Promise<void> {
  const store = await load(WORKSPACE_STORE_NAME, {
    defaults: {},
    autoSave: true,
  });
  await store.set(ACTIVE_WORKSPACE_FIELD, id);
  await store.save();
}

export const useWorkspaceStore = create<WorkspaceState>()((set, get) => ({
  workspaces: [],
  activeWorkspaceId: DEFAULT_WORKSPACE_ID,
  isInitialLoadDone: false,

  loadWorkspaces: async () => {
    try {
      // Self-heal: an install must always have at least one workspace.
      await ensureDefaultWorkspace();
      const workspaces = await listWorkspaces();

      const store = await load(WORKSPACE_STORE_NAME, {
        defaults: {},
        autoSave: false,
      });
      const stored = await store.get<unknown>(ACTIVE_WORKSPACE_FIELD);

      // Validate the persisted id against the live list: a workspace deleted in a
      // prior session must not leave every query scoped to a nonexistent id.
      const persistedId = typeof stored === "string" ? stored : null;
      const exists =
        persistedId !== null && workspaces.some((w) => w.id === persistedId);
      const fallback =
        workspaces.find((w) => w.id === DEFAULT_WORKSPACE_ID)?.id ??
        workspaces[0]?.id ??
        DEFAULT_WORKSPACE_ID;
      const activeWorkspaceId = exists ? (persistedId as string) : fallback;

      setCurrentWorkspaceId(activeWorkspaceId);
      set({ workspaces, activeWorkspaceId, isInitialLoadDone: true });
    } catch (error) {
      logger.error({ err: error }, "[Workspace] Failed to load workspaces");
      setCurrentWorkspaceId(DEFAULT_WORKSPACE_ID);
      set({ isInitialLoadDone: true });
    }
  },

  setActiveWorkspace: async (id: string) => {
    if (id === get().activeWorkspaceId) {
      return;
    }
    // Mirror to the seam first so any query the remount triggers scopes correctly.
    setCurrentWorkspaceId(id);
    set({ activeWorkspaceId: id });
    try {
      await persistActiveWorkspace(id);
    } catch (error) {
      logger.error(
        { err: error },
        "[Workspace] Failed to persist active workspace"
      );
    }
  },

  createWorkspace: async (name: string) => {
    const workspace = await createWorkspaceRow(name);
    set((state) => ({ workspaces: [workspace, ...state.workspaces] }));
    await get().setActiveWorkspace(workspace.id);
    return workspace;
  },

  renameWorkspace: async (id: string, name: string) => {
    const updated = await renameWorkspaceRow(id, name);
    if (!updated) {
      return;
    }
    set((state) => ({
      workspaces: state.workspaces.map((w) => (w.id === id ? updated : w)),
    }));
  },

  deleteWorkspace: async (id: string) => {
    const total = await countWorkspaces();
    if (total <= 1) {
      throw new Error("Cannot delete the last workspace");
    }
    await deleteWorkspaceRow(id);

    const remaining = get().workspaces.filter((w) => w.id !== id);
    set({ workspaces: remaining });

    // If the active workspace was the one deleted, switch to another.
    if (get().activeWorkspaceId === id) {
      const next =
        remaining.find((w) => w.id === DEFAULT_WORKSPACE_ID)?.id ??
        remaining[0]?.id ??
        DEFAULT_WORKSPACE_ID;
      await get().setActiveWorkspace(next);
    }
  },
}));
