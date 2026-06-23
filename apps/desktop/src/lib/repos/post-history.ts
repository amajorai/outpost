/**
 * Repository for the `post_history` table (U10).
 *
 * One terminal record per target publish attempt: status (`published` or
 * `failed`), the remote url/id on success, the error message on failure, and
 * the publish timestamp. The publish pipeline writes exactly one row per target
 * once retries are exhausted — not one row per attempt — so the table is the
 * audit log of "what actually happened" for each fanned-out target.
 *
 * Columns are snake_case in SQLite; the domain `PostHistory` shape is camelCase.
 * We map explicitly in both directions rather than casting a `SELECT *` row,
 * mirroring the sibling repos.
 */

import { getDb } from "@/lib/db";
import type { PostHistory, PostHistoryStatus } from "@/lib/social-schema";

/** Row shape as returned by the snake_case `post_history` table. */
interface PostHistoryRow {
  id: string;
  post_target_id: string;
  status: string;
  remote_url: string | null;
  remote_id: string | null;
  error: string | null;
  published_at: number | null;
}

/** The columns we select, in order, so we never cast a `SELECT *` row. */
const SELECT_COLUMNS =
  "id, post_target_id, status, remote_url, remote_id, error, published_at";

/** Map a snake_case DB row to the camelCase domain shape. */
function mapRow(row: PostHistoryRow): PostHistory {
  return {
    id: row.id,
    postTargetId: row.post_target_id,
    status: row.status as PostHistoryStatus,
    remoteUrl: row.remote_url,
    remoteId: row.remote_id,
    error: row.error,
    publishedAt: row.published_at,
  };
}

/** Fields a caller supplies when recording a publish outcome. */
export interface RecordPostHistoryInput {
  /** The `post_targets.id` this outcome belongs to. */
  postTargetId: string;
  /** `published` on success, `failed` after retries are exhausted. */
  status: PostHistoryStatus;
  /** Canonical URL of the published post, when available. */
  remoteUrl?: string | null;
  /** The post id as known to the remote platform, when available. */
  remoteId?: string | null;
  /** Error message when the attempt failed, else null. */
  error?: string | null;
  /** Unix epoch millis the outcome was recorded. Defaults to now. */
  publishedAt?: number;
}

/**
 * Insert one terminal `post_history` row for a target. Returns the persisted
 * domain row. Callers write this once per target after retries are exhausted.
 */
export async function recordPostHistory(
  input: RecordPostHistoryInput
): Promise<PostHistory> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const remoteUrl = input.remoteUrl ?? null;
  const remoteId = input.remoteId ?? null;
  const error = input.error ?? null;
  const publishedAt = input.publishedAt ?? Date.now();

  await db.execute(
    "INSERT INTO post_history (id, post_target_id, status, remote_url, remote_id, error, published_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [
      id,
      input.postTargetId,
      input.status,
      remoteUrl,
      remoteId,
      error,
      publishedAt,
    ]
  );

  return {
    id,
    postTargetId: input.postTargetId,
    status: input.status,
    remoteUrl,
    remoteId,
    error,
    publishedAt,
  };
}

/** List the publish history for a single target, newest first. */
export async function listPostHistoryForTarget(
  postTargetId: string
): Promise<PostHistory[]> {
  const db = await getDb();
  const rows = await db.select<PostHistoryRow[]>(
    `SELECT ${SELECT_COLUMNS} FROM post_history WHERE post_target_id = $1 ORDER BY published_at DESC`,
    [postTargetId]
  );
  return rows.map(mapRow);
}

/**
 * One successfully-published target for an account, with everything the
 * activity feed (U21) needs to read its engagement: the remote id/url to query
 * the provider with, the platform, the per-target body override (the only local
 * text we have, often null), and when it published.
 */
export interface PublishedTarget {
  platform: string;
  remoteId: string;
  remoteUrl: string | null;
  variantBody: string | null;
  publishedAt: number | null;
}

/** Row shape for the published-targets join. */
interface PublishedTargetRow {
  platform: string;
  remote_id: string;
  remote_url: string | null;
  variant_body: string | null;
  published_at: number | null;
}

/**
 * List every post successfully published to one social account, newest first.
 *
 * Providers expose `readEngagement(ref)` but no "list my posts", so the set of
 * trackable posts must come from what Outpost published locally. A `published`
 * `post_history` row with a non-null `remote_id` is exactly that: a post we can
 * re-query. We join `post_targets` for the account + platform, scoping by the
 * target's `social_account_id` (the account itself is already workspace-scoped,
 * so no `scheduled_posts` join is needed).
 */
export async function listPublishedTargetsForAccount(
  socialAccountId: string
): Promise<PublishedTarget[]> {
  const db = await getDb();
  const rows = await db.select<PublishedTargetRow[]>(
    `SELECT pt.platform AS platform, ph.remote_id AS remote_id, ph.remote_url AS remote_url, pt.variant_body AS variant_body, ph.published_at AS published_at
     FROM post_history ph
     JOIN post_targets pt ON pt.id = ph.post_target_id
     WHERE pt.social_account_id = $1 AND ph.status = 'published' AND ph.remote_id IS NOT NULL
     ORDER BY ph.published_at DESC`,
    [socialAccountId]
  );
  return rows.map((row) => ({
    platform: row.platform,
    remoteId: row.remote_id,
    remoteUrl: row.remote_url,
    variantBody: row.variant_body,
    publishedAt: row.published_at,
  }));
}
