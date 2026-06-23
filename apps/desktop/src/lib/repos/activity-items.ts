/**
 * Repository for the `activity_items` table (U21).
 *
 * The activity feed: one row per published post the app is tracking, holding
 * its latest engagement counts (likes / comments / shares / views). Rows are
 * aggregated across every connected account so the feed is a single timeline of
 * what was published and how it's performing.
 *
 * Persistence is an upsert keyed on (workspace_id, social_account_id,
 * post_remote_id) — the UNIQUE index added in the v13 -> v14 migration. A second
 * refresh of the same post updates its metrics in place rather than duplicating
 * it, the activity-feed analogue of the inbox's `INSERT OR IGNORE` dedupe.
 *
 * Columns are snake_case in SQLite; the domain `ActivityItem` shape is
 * camelCase. We map explicitly in both directions rather than casting a
 * `SELECT *` row, mirroring the sibling repos.
 */

import { getDb } from "@/lib/db";
import { type ActivityItem, DEFAULT_WORKSPACE_ID } from "@/lib/social-schema";

/** Row shape as returned by the snake_case `activity_items` table. */
interface ActivityItemRow {
  id: string;
  workspace_id: string;
  social_account_id: string;
  platform: string;
  post_remote_id: string;
  permalink: string | null;
  text: string | null;
  likes: number;
  comments: number;
  shares: number;
  views: number;
  engagement_fetched_at: number | null;
  published_at: number | null;
}

/** The columns we select, in order, so we never cast a `SELECT *` row. */
const SELECT_COLUMNS =
  "id, workspace_id, social_account_id, platform, post_remote_id, permalink, text, likes, comments, shares, views, engagement_fetched_at, published_at";

/** Map a snake_case DB row to the camelCase domain shape. */
function mapRow(row: ActivityItemRow): ActivityItem {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    socialAccountId: row.social_account_id,
    platform: row.platform,
    postRemoteId: row.post_remote_id,
    permalink: row.permalink,
    text: row.text,
    likes: row.likes,
    comments: row.comments,
    shares: row.shares,
    views: row.views,
    engagementFetchedAt: row.engagement_fetched_at,
    publishedAt: row.published_at,
  };
}

/** Fields a caller supplies when upserting a tracked published post. */
export interface UpsertActivityItemInput {
  socialAccountId: string;
  platform: string;
  /** The post's id as known to the remote platform — part of the dedupe key. */
  postRemoteId: string;
  permalink?: string | null;
  text?: string | null;
  likes?: number;
  comments?: number;
  shares?: number;
  views?: number;
  /** Unix epoch millis the counts were read, when known. */
  engagementFetchedAt?: number | null;
  publishedAt?: number | null;
  /** Workspace to scope the item to. Defaults to the default workspace. */
  workspaceId?: string;
}

/**
 * Insert a tracked post, or update its engagement counts when it already
 * exists (same workspace + account + remote id). The metadata columns
 * (permalink / text / published_at) only overwrite when a fresh non-null value
 * is supplied, so a metrics-only refresh never clobbers known metadata with a
 * null.
 */
export async function upsertActivityItem(
  input: UpsertActivityItemInput
): Promise<void> {
  const db = await getDb();
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  await db.execute(
    `INSERT INTO activity_items (id, workspace_id, social_account_id, platform, post_remote_id, permalink, text, likes, comments, shares, views, engagement_fetched_at, published_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT(workspace_id, social_account_id, post_remote_id) DO UPDATE SET
       platform = excluded.platform,
       permalink = COALESCE(excluded.permalink, activity_items.permalink),
       text = COALESCE(excluded.text, activity_items.text),
       likes = excluded.likes,
       comments = excluded.comments,
       shares = excluded.shares,
       views = excluded.views,
       engagement_fetched_at = excluded.engagement_fetched_at,
       published_at = COALESCE(excluded.published_at, activity_items.published_at)`,
    [
      crypto.randomUUID(),
      workspaceId,
      input.socialAccountId,
      input.platform,
      input.postRemoteId,
      input.permalink ?? null,
      input.text ?? null,
      input.likes ?? 0,
      input.comments ?? 0,
      input.shares ?? 0,
      input.views ?? 0,
      input.engagementFetchedAt ?? null,
      input.publishedAt ?? null,
    ]
  );
}

/** List all activity items for a workspace, newest published first. */
export async function listActivityItems(
  workspaceId: string = DEFAULT_WORKSPACE_ID
): Promise<ActivityItem[]> {
  const db = await getDb();
  const rows = await db.select<ActivityItemRow[]>(
    `SELECT ${SELECT_COLUMNS} FROM activity_items WHERE workspace_id = $1 ORDER BY published_at DESC, engagement_fetched_at DESC`,
    [workspaceId]
  );
  return rows.map(mapRow);
}
