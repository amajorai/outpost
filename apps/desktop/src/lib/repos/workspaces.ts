/**
 * Repository for the `workspaces` table (U32).
 *
 * A workspace is a tenant boundary: every domain row carries a `workspace_id`
 * (seeded by the v10 migration in `lib/db.ts`). This repo owns the lifecycle of
 * the workspaces themselves — create, rename, list, delete — on top of the
 * scoping that already exists in every other repo.
 *
 * The `workspaces` table predates this unit (created in the v10 migration) and
 * uses camelCase column names (`id`, `name`, `createdAt`) unlike the snake_case
 * domain tables, so this repo maps that one table accordingly.
 *
 * Delete safety (the unit's footgun contract):
 * - Deleting the *last* workspace is refused — an install must always have at
 *   least one workspace so `getCurrentWorkspaceId()` resolves to a real row.
 * - A delete cascades to every workspace-scoped row, including child tables that
 *   reach the workspace through a parent (post_targets via scheduled_posts,
 *   post_history via post_targets, experiment_variants/results via experiments).
 *   The cascade runs as direct SQL here rather than calling sibling repos, both
 *   to keep it a single transaction and to avoid an import cycle.
 */

import { getDb } from "@/lib/db";
import { DEFAULT_WORKSPACE_ID, type Workspace } from "@/lib/social-schema";

/** Row shape as returned by the camelCase `workspaces` table. */
interface WorkspaceRow {
  id: string;
  name: string;
  createdAt: number;
}

const SELECT_COLUMNS = "id, name, createdAt";

function mapRow(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
  };
}

/**
 * Domain tables with their own `workspace_id` column. A delete removes the
 * workspace's rows from each directly. Child tables that scope through a parent
 * are handled separately below.
 */
const WORKSPACE_SCOPED_TABLES = [
  "social_accounts",
  "drafts",
  "scheduled_posts",
  "templates",
  "media_assets",
  "brand_kit",
  "inbox_items",
  "activity_items",
  "voice_profile",
  "experiments",
  "autoresearch_strategy",
  "autoresearch_iterations",
  "radar_targets",
  "trend_signals",
  "autopilot_actions",
  "deals",
  "tracked_links",
  // Legacy domain tables back-filled with workspace_id in the v10 migration.
  "thumbnails",
  "trash",
  "project_revisions",
  "folders",
  "archive_folders",
  "ai_projects",
  "yt_favourites",
  "yt_collections",
  "yt_collection_items",
  "yt_thumbnail_history",
] as const;

/** List all workspaces, newest first (the default workspace usually sorts last). */
export async function listWorkspaces(): Promise<Workspace[]> {
  const db = await getDb();
  const rows = await db.select<WorkspaceRow[]>(
    `SELECT ${SELECT_COLUMNS} FROM workspaces ORDER BY createdAt DESC`
  );
  return rows.map(mapRow);
}

/** Load a single workspace by id, or null when it doesn't exist. */
export async function getWorkspace(id: string): Promise<Workspace | null> {
  const db = await getDb();
  const rows = await db.select<WorkspaceRow[]>(
    `SELECT ${SELECT_COLUMNS} FROM workspaces WHERE id = $1`,
    [id]
  );
  const row = rows[0];
  return row ? mapRow(row) : null;
}

/** Create a workspace with the given display name. Returns the persisted row. */
export async function createWorkspace(name: string): Promise<Workspace> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("A workspace name is required");
  }
  const db = await getDb();
  const id = crypto.randomUUID();
  const createdAt = Date.now();
  await db.execute(
    "INSERT INTO workspaces (id, name, createdAt) VALUES ($1, $2, $3)",
    [id, trimmed, createdAt]
  );
  return { id, name: trimmed, createdAt };
}

/** Rename a workspace. Returns the updated row, or null when it doesn't exist. */
export async function renameWorkspace(
  id: string,
  name: string
): Promise<Workspace | null> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("A workspace name is required");
  }
  const db = await getDb();
  const result = await db.execute(
    "UPDATE workspaces SET name = $1 WHERE id = $2",
    [trimmed, id]
  );
  if (result.rowsAffected === 0) {
    return null;
  }
  return getWorkspace(id);
}

/** Count how many workspaces exist. */
export async function countWorkspaces(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<[{ count: number }]>(
    "SELECT COUNT(*) AS count FROM workspaces"
  );
  return rows[0]?.count ?? 0;
}

/**
 * Delete a workspace and every row scoped to it, in a single transaction.
 *
 * Refuses to delete the last remaining workspace (an install must always keep at
 * least one). Cascades to all workspace-scoped tables and to the child tables
 * that reach the workspace through a parent.
 *
 * Throws when the workspace is the last one so the caller can surface a clear
 * message rather than silently leaving the install workspace-less.
 */
export async function deleteWorkspace(id: string): Promise<void> {
  const db = await getDb();

  const total = await countWorkspaces();
  if (total <= 1) {
    throw new Error("Cannot delete the last workspace");
  }

  await db.execute("BEGIN TRANSACTION");
  try {
    // Child tables first: rows that reach the workspace through a parent. Delete
    // them via subqueries before the parents are removed.
    await db.execute(
      `DELETE FROM post_history WHERE post_target_id IN (
         SELECT pt.id FROM post_targets pt
         JOIN scheduled_posts sp ON sp.id = pt.scheduled_post_id
         WHERE sp.workspace_id = $1
       )`,
      [id]
    );
    await db.execute(
      `DELETE FROM post_targets WHERE scheduled_post_id IN (
         SELECT id FROM scheduled_posts WHERE workspace_id = $1
       )`,
      [id]
    );
    await db.execute(
      `DELETE FROM experiment_results WHERE experiment_id IN (
         SELECT id FROM experiments WHERE workspace_id = $1
       )`,
      [id]
    );
    await db.execute(
      `DELETE FROM experiment_variants WHERE experiment_id IN (
         SELECT id FROM experiments WHERE workspace_id = $1
       )`,
      [id]
    );

    // Then every table that carries its own workspace_id.
    for (const table of WORKSPACE_SCOPED_TABLES) {
      await db.execute(`DELETE FROM ${table} WHERE workspace_id = $1`, [id]);
    }

    // Finally the workspace row itself.
    await db.execute("DELETE FROM workspaces WHERE id = $1", [id]);
    await db.execute("COMMIT");
  } catch (err) {
    await db.execute("ROLLBACK");
    throw err;
  }
}

/**
 * Ensure the default workspace exists. The v10 migration seeds it, but this keeps
 * the "always at least one workspace" invariant explicit and self-healing.
 */
export async function ensureDefaultWorkspace(): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT OR IGNORE INTO workspaces (id, name, createdAt) VALUES ($1, $2, $3)",
    [DEFAULT_WORKSPACE_ID, "Default", Date.now()]
  );
}
