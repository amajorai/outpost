/**
 * Repository for the `scheduled_posts` + `post_targets` tables (U8).
 *
 * Scheduling fans a single composed post out to one `post_target` per selected
 * account. The parent `scheduled_posts` row plus its target rows are written in
 * one transaction so a partial failure never orphans targets without a parent.
 *
 * Status contract (see `social-schema.ts` and the U9 scheduler):
 * - `scheduled_posts.status` starts as `"scheduled"`. The scheduler's sweep
 *   selects `WHERE status = 'scheduled' AND scheduled_for <= now`, so this is the
 *   value that makes a post eligible to fire — including "post now", which is
 *   simply a schedule with `scheduledFor = now`.
 * - `post_targets.status` starts as `"pending"`; the publish pipeline (U10)
 *   advances each target through `publishing` to `published`/`failed`.
 *
 * Columns are snake_case in SQLite; the domain shapes are camelCase. We map
 * explicitly rather than casting a `SELECT *` row, mirroring the sibling repos.
 */

import { getDb } from "@/lib/db";
import {
  DEFAULT_WORKSPACE_ID,
  type PostTarget,
  type ScheduledPost,
  type ScheduledPostStatus,
} from "@/lib/social-schema";

/** A single account a scheduled post is fanned out to. */
export interface ScheduleTargetInput {
  /** The `social_accounts.id` this target publishes to. */
  socialAccountId: string;
  /** Platform key for the account, copied onto the target row. */
  platform: string;
  /** Per-target body override; omit to use the draft body verbatim. */
  variantBody?: string | null;
}

/** Fields a caller supplies when scheduling a post. */
export interface CreateScheduledPostInput {
  /** The draft this post came from, when saved; null for ad-hoc posts. */
  draftId?: string | null;
  /** Unix epoch millis to publish at. Use `Date.now()` for "post now". */
  scheduledFor: number;
  /** One entry per selected account. Must be non-empty. */
  targets: ScheduleTargetInput[];
  /** Workspace to scope the post to. Defaults to the default workspace. */
  workspaceId?: string;
}

/** The persisted result of scheduling: the parent row and its target rows. */
export interface CreatedSchedule {
  post: ScheduledPost;
  targets: PostTarget[];
}

/** Row shape as returned by the snake_case `scheduled_posts` table. */
interface ScheduledPostRow {
  id: string;
  workspace_id: string;
  draft_id: string | null;
  scheduled_for: number;
  status: string;
  created_at: number;
}

/** Row shape as returned by the snake_case `post_targets` table. */
interface PostTargetRow {
  id: string;
  scheduled_post_id: string;
  social_account_id: string;
  platform: string;
  variant_body: string | null;
  status: string;
}

const SCHEDULED_POST_COLUMNS =
  "id, workspace_id, draft_id, scheduled_for, status, created_at";
const POST_TARGET_COLUMNS =
  "id, scheduled_post_id, social_account_id, platform, variant_body, status";

function mapScheduledPostRow(row: ScheduledPostRow): ScheduledPost {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    draftId: row.draft_id,
    scheduledFor: row.scheduled_for,
    status: row.status as ScheduledPostStatus,
    createdAt: row.created_at,
  };
}

function mapPostTargetRow(row: PostTargetRow): PostTarget {
  return {
    id: row.id,
    scheduledPostId: row.scheduled_post_id,
    socialAccountId: row.social_account_id,
    platform: row.platform,
    variantBody: row.variant_body,
    status: row.status as PostTarget["status"],
  };
}

/**
 * Schedule a post: write one `scheduled_posts` row and one `post_targets` row per
 * target, atomically. The post starts `scheduled` (eligible for the U9 sweep) and
 * each target starts `pending`. Throws if there are no targets.
 */
export async function createScheduledPost(
  input: CreateScheduledPostInput
): Promise<CreatedSchedule> {
  if (input.targets.length === 0) {
    throw new Error("Cannot schedule a post with no targets");
  }

  const db = await getDb();
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const draftId = input.draftId ?? null;
  const createdAt = Date.now();
  const postId = crypto.randomUUID();
  // Explicitly type as the status union so a wrong literal is a compile error:
  // the scheduler only picks up "scheduled" rows.
  const postStatus: ScheduledPostStatus = "scheduled";

  const targets: PostTarget[] = input.targets.map((target) => ({
    id: crypto.randomUUID(),
    scheduledPostId: postId,
    socialAccountId: target.socialAccountId,
    platform: target.platform,
    variantBody: target.variantBody ?? null,
    status: "pending",
  }));

  await db.execute("BEGIN TRANSACTION");
  try {
    await db.execute(
      "INSERT INTO scheduled_posts (id, workspace_id, draft_id, scheduled_for, status, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
      [postId, workspaceId, draftId, input.scheduledFor, postStatus, createdAt]
    );
    for (const target of targets) {
      await db.execute(
        "INSERT INTO post_targets (id, scheduled_post_id, social_account_id, platform, variant_body, status) VALUES ($1, $2, $3, $4, $5, $6)",
        [
          target.id,
          target.scheduledPostId,
          target.socialAccountId,
          target.platform,
          target.variantBody,
          target.status,
        ]
      );
    }
    await db.execute("COMMIT");
  } catch (err) {
    await db.execute("ROLLBACK");
    throw err;
  }

  return {
    post: {
      id: postId,
      workspaceId,
      draftId,
      scheduledFor: input.scheduledFor,
      status: postStatus,
      createdAt,
    },
    targets,
  };
}

/** List scheduled posts for a workspace, soonest first. */
export async function listScheduledPosts(
  workspaceId: string = DEFAULT_WORKSPACE_ID
): Promise<ScheduledPost[]> {
  const db = await getDb();
  const rows = await db.select<ScheduledPostRow[]>(
    `SELECT ${SCHEDULED_POST_COLUMNS} FROM scheduled_posts WHERE workspace_id = $1 ORDER BY scheduled_for ASC`,
    [workspaceId]
  );
  return rows.map(mapScheduledPostRow);
}

/** List the targets fanned out from a scheduled post. */
export async function listPostTargets(
  scheduledPostId: string
): Promise<PostTarget[]> {
  const db = await getDb();
  const rows = await db.select<PostTargetRow[]>(
    `SELECT ${POST_TARGET_COLUMNS} FROM post_targets WHERE scheduled_post_id = $1`,
    [scheduledPostId]
  );
  return rows.map(mapPostTargetRow);
}
