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
