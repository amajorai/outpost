/**
 * Repository for the `inbox_items` table (U20).
 *
 * The unified engagement inbox: comments, replies, mentions, and DMs read from
 * connected accounts and persisted so the inbox is stable across refreshes.
 *
 * Persistence is idempotent. A UNIQUE index on
 * (workspace_id, social_account_id, external_id) backs an `INSERT OR IGNORE`,
 * so re-reading the inbox never duplicates a previously-seen remote item — the
 * same dedupe precedent as the v10 workspace seed.
 *
 * Columns are snake_case in SQLite; the domain `InboxItem` shape is camelCase.
 * We map explicitly in both directions rather than casting a `SELECT *` row,
 * mirroring the sibling repos.
 */

import { getCurrentWorkspaceId } from "@/lib/current-workspace";
import { getDb } from "@/lib/db";
import type { InboxItem, InboxItemKind } from "@/lib/social-schema";

/** Row shape as returned by the snake_case `inbox_items` table. */
interface InboxItemRow {
  id: string;
  workspace_id: string;
  social_account_id: string;
  platform: string;
  kind: string;
  author: string;
  text: string;
  permalink: string | null;
  external_id: string;
  received_at: number;
  replied: number;
}

/** The columns we select, in order, so we never cast a `SELECT *` row. */
const SELECT_COLUMNS =
  "id, workspace_id, social_account_id, platform, kind, author, text, permalink, external_id, received_at, replied";

/** Map a snake_case DB row to the camelCase domain shape. */
function mapRow(row: InboxItemRow): InboxItem {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    socialAccountId: row.social_account_id,
    platform: row.platform,
    kind: row.kind as InboxItemKind,
    author: row.author,
    text: row.text,
    permalink: row.permalink,
    externalId: row.external_id,
    receivedAt: row.received_at,
    replied: row.replied,
  };
}

/** Fields a caller supplies when persisting a freshly-read inbox item. */
export interface CreateInboxItemInput {
  socialAccountId: string;
  platform: string;
  kind: InboxItemKind;
  author: string;
  text: string;
  permalink?: string | null;
  externalId: string;
  receivedAt: number;
  /** Workspace to scope the item to. Defaults to the default workspace. */
  workspaceId?: string;
}

/**
 * Persist an inbox item, ignoring a re-insert of an item we've already stored
 * (same workspace + account + external id). Returns true when a new row was
 * inserted, false when the dedupe index caused it to be ignored.
 */
export async function createInboxItem(
  input: CreateInboxItemInput
): Promise<boolean> {
  const db = await getDb();
  const workspaceId = input.workspaceId ?? getCurrentWorkspaceId();
  const result = await db.execute(
    "INSERT OR IGNORE INTO inbox_items (id, workspace_id, social_account_id, platform, kind, author, text, permalink, external_id, received_at, replied) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
    [
      crypto.randomUUID(),
      workspaceId,
      input.socialAccountId,
      input.platform,
      input.kind,
      input.author,
      input.text,
      input.permalink ?? null,
      input.externalId,
      input.receivedAt,
      0,
    ]
  );
  return result.rowsAffected > 0;
}

/** List all inbox items for a workspace, newest first. */
export async function listInboxItems(
  workspaceId: string = getCurrentWorkspaceId()
): Promise<InboxItem[]> {
  const db = await getDb();
  const rows = await db.select<InboxItemRow[]>(
    `SELECT ${SELECT_COLUMNS} FROM inbox_items WHERE workspace_id = $1 ORDER BY received_at DESC`,
    [workspaceId]
  );
  return rows.map(mapRow);
}

/** Mark an inbox item as replied. Returns true when a row was updated. */
export async function markInboxItemReplied(id: string): Promise<boolean> {
  const db = await getDb();
  const result = await db.execute(
    "UPDATE inbox_items SET replied = 1 WHERE id = $1",
    [id]
  );
  return result.rowsAffected > 0;
}
