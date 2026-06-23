/**
 * The active-workspace seam (U32).
 *
 * A tiny standalone module holding the id of the workspace the user is currently
 * viewing. Repos read it through {@link getCurrentWorkspaceId} as their default
 * scope, so flipping one value re-scopes every data view to the active workspace
 * without each repo depending on (or importing) the Zustand store.
 *
 * This module is deliberately dependency-free: the store (`use-workspace-store`)
 * imports and *writes* to it, and repos *read* from it. Were a repo to import the
 * store instead, the workspaces repo's delete-cascade (which the store calls)
 * would form an import cycle. Keeping the current id here breaks that cycle.
 *
 * `getCurrentWorkspaceId()` returns the {@link DEFAULT_WORKSPACE_ID} until the
 * persisted id resolves on startup, so a query that fires before the store has
 * loaded still scopes to a real, always-present workspace rather than throwing.
 */

import { DEFAULT_WORKSPACE_ID } from "@/lib/social-schema";

let currentWorkspaceId: string = DEFAULT_WORKSPACE_ID;

/**
 * The id of the workspace all repos scope to by default. Synchronous so a repo's
 * default-parameter expression can read it without awaiting the store.
 */
export function getCurrentWorkspaceId(): string {
  return currentWorkspaceId;
}

/**
 * Set the active workspace id. Called only by `use-workspace-store` when the user
 * switches workspaces or when the persisted id resolves on startup. Repos read
 * the new value on their next query.
 */
export function setCurrentWorkspaceId(id: string): void {
  currentWorkspaceId = id;
}
