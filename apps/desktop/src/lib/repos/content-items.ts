/**
 * Repository for the `content_items` table (U33).
 *
 * The production pipeline: one row per content idea, moved through a fixed
 * production lifecycle (idea -> script -> record -> edit -> publish) that the
 * kanban groups its columns by. `body` is a JSON draft-body blob (the
 * `drafts.body` precedent) stored raw; the composer decodes it on promote, so a
 * card carries the post text it becomes without this repo knowing the shape.
 *
 * Columns are snake_case in SQLite; the domain `ContentItem` shape is camelCase.
 * We map explicitly in both directions rather than casting a `SELECT *` row,
 * mirroring the sibling repos. Queries are scoped by `workspace_id`.
 */

import { getCurrentWorkspaceId } from "@/lib/current-workspace";
import { getDb } from "@/lib/db";
import type { ContentItem, ContentStage } from "@/lib/social-schema";

/** Row shape as returned by the snake_case `content_items` table. */
interface ContentItemRow {
  id: string;
  workspace_id: string;
  title: string;
  stage: string;
  notes: string | null;
  body: string;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

const SELECT_COLUMNS =
  "id, workspace_id, title, stage, notes, body, sort_order, created_at, updated_at";

const DEFAULT_STAGE: ContentStage = "idea";
const DEFAULT_BODY = "{}";

function mapRow(row: ContentItemRow): ContentItem {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    title: row.title,
    stage: row.stage as ContentStage,
    notes: row.notes,
    body: row.body,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Fields a caller supplies when creating a content item. */
export interface CreateContentItemInput {
  title: string;
  stage?: ContentStage;
  notes?: string | null;
  /** JSON draft-body blob to persist; defaults to an empty body. */
  body?: string;
  workspaceId?: string;
}

/**
 * Create a content item. Defaults to an `idea` with no notes and an empty body.
 * The new card is appended to the end of its stage column (highest sort_order).
 */
export async function createContentItem(
  input: CreateContentItemInput
): Promise<ContentItem> {
  const db = await getDb();
  const workspaceId = input.workspaceId ?? getCurrentWorkspaceId();
  const id = crypto.randomUUID();
  const now = Date.now();
  const stage = input.stage ?? DEFAULT_STAGE;
  const notes = input.notes ?? null;
  const body = input.body ?? DEFAULT_BODY;

  const maxRows = await db.select<[{ next: number }]>(
    "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM content_items WHERE workspace_id = $1 AND stage = $2",
    [workspaceId, stage]
  );
  const sortOrder = maxRows[0]?.next ?? 0;

  await db.execute(
    `INSERT INTO content_items (id, workspace_id, title, stage, notes, body, sort_order, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, workspaceId, input.title, stage, notes, body, sortOrder, now, now]
  );
  return {
    id,
    workspaceId,
    title: input.title,
    stage,
    notes,
    body,
    sortOrder,
    createdAt: now,
    updatedAt: now,
  };
}

/** List a workspace's content items, ordered for the kanban (stage, then sort). */
export async function listContentItems(
  workspaceId: string = getCurrentWorkspaceId()
): Promise<ContentItem[]> {
  const db = await getDb();
  const rows = await db.select<ContentItemRow[]>(
    `SELECT ${SELECT_COLUMNS} FROM content_items WHERE workspace_id = $1 ORDER BY stage, sort_order, created_at`,
    [workspaceId]
  );
  return rows.map(mapRow);
}

/** Load a single content item by id, or null when it doesn't exist. */
export async function getContentItem(id: string): Promise<ContentItem | null> {
  const db = await getDb();
  const rows = await db.select<ContentItemRow[]>(
    `SELECT ${SELECT_COLUMNS} FROM content_items WHERE id = $1`,
    [id]
  );
  const row = rows[0];
  return row ? mapRow(row) : null;
}

/** Fields a caller can change on an existing content item. */
export interface UpdateContentItemInput {
  title?: string;
  notes?: string | null;
  body?: string;
}

/**
 * Patch a content item in place (the card editor). Only supplied fields change;
 * omitted fields keep their stored value. `notes` is nullable, so undefined means
 * "leave as is" while an explicit null clears it. A no-op when the id doesn't
 * exist. Always bumps `updated_at`.
 */
export async function updateContentItem(
  id: string,
  patch: UpdateContentItemInput
): Promise<void> {
  const db = await getDb();
  const notesProvided = patch.notes !== undefined ? 1 : 0;
  await db.execute(
    `UPDATE content_items SET
       title = COALESCE($2, title),
       notes = CASE WHEN $3 = 1 THEN $4 ELSE notes END,
       body = COALESCE($5, body),
       updated_at = $6
     WHERE id = $1`,
    [
      id,
      patch.title ?? null,
      notesProvided,
      patch.notes ?? null,
      patch.body ?? null,
      Date.now(),
    ]
  );
}

/**
 * Move a content item to a new stage (the kanban move). Appends it to the end of
 * the destination stage column so it lands predictably rather than colliding with
 * an existing sort_order. A no-op when the id doesn't exist.
 */
export async function setContentItemStage(
  id: string,
  stage: ContentStage
): Promise<void> {
  const db = await getDb();
  const existing = await getContentItem(id);
  if (!existing) {
    return;
  }
  const maxRows = await db.select<[{ next: number }]>(
    "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM content_items WHERE workspace_id = $1 AND stage = $2",
    [existing.workspaceId, stage]
  );
  const sortOrder = maxRows[0]?.next ?? 0;
  await db.execute(
    "UPDATE content_items SET stage = $1, sort_order = $2, updated_at = $3 WHERE id = $4",
    [stage, sortOrder, Date.now(), id]
  );
}

/**
 * Reorder a content item within (or into) a stage by writing its `sort_order`
 * directly. Callers compute the target order; this just persists it and bumps
 * `updated_at`. A no-op when the id doesn't exist.
 */
export async function reorderContentItem(
  id: string,
  sortOrder: number
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE content_items SET sort_order = $1, updated_at = $2 WHERE id = $3",
    [sortOrder, Date.now(), id]
  );
}

/** Delete a content item by id. */
export async function deleteContentItem(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM content_items WHERE id = $1", [id]);
}
