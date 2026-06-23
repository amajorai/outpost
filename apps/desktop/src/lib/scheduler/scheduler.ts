/**
 * Local scheduler engine (U9).
 *
 * Outpost has no cloud worker: scheduled posts fire only while the app is
 * running. This module polls `scheduled_posts` on an interval, finds rows whose
 * time has elapsed, transitions them `scheduled -> due`, and emits them to
 * subscribers (the publish pipeline, U10).
 *
 * Why a frontend TS service rather than the spec's aspirational tokio task:
 * the SQLite database is reached exclusively through `@tauri-apps/plugin-sql`
 * from the webview. A Rust-side tokio scheduler would need its own DB
 * connection and would race the frontend's writes (WAL helps but doesn't make
 * cross-process row-state coordination free). Keeping the scheduler in the same
 * process that owns every other DB mutation is the DB-consistent, pragmatic
 * choice, and it is exactly where the rest of the posting logic (compose,
 * publish) already lives.
 *
 * Correctness notes:
 * - The `scheduled -> due` transition is the idempotency guard. A sweep selects
 *   `scheduled` rows, flips them to `due`, then emits. The next sweep can no
 *   longer select them, so `onDue` fires exactly once per post.
 * - A re-entrancy flag prevents two overlapping sweeps from racing the same
 *   rows if a sweep ever outlasts the interval.
 * - A module-level singleton guards against React StrictMode double-starts.
 */

import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { ScheduledPost } from "@/lib/social-schema";

/** How often the scheduler polls for due posts while running. */
export const SCHEDULER_POLL_INTERVAL_MS = 30_000;

/** A subscriber notified when a batch of posts becomes due. */
export type DueListener = (posts: ScheduledPost[]) => void;

/** Row shape as returned by the snake_case `scheduled_posts` table. */
interface ScheduledPostRow {
  id: string;
  workspace_id: string;
  draft_id: string | null;
  scheduled_for: number;
  status: string;
  created_at: number;
}

/** Explicitly map a snake_case DB row to the camelCase domain shape. */
function mapRow(row: ScheduledPostRow): ScheduledPost {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    draftId: row.draft_id,
    scheduledFor: row.scheduled_for,
    status: row.status as ScheduledPost["status"],
    createdAt: row.created_at,
  };
}

const listeners = new Set<DueListener>();

let intervalId: ReturnType<typeof setInterval> | null = null;
let isSweeping = false;

function emitDue(posts: ScheduledPost[]): void {
  for (const listener of listeners) {
    try {
      listener(posts);
    } catch (err) {
      logger.error({ err }, "[Scheduler] onDue listener threw");
    }
  }
}

/**
 * Run a single sweep: find `scheduled` posts whose time has elapsed, transition
 * them to `due`, and emit them. Re-entrant calls are skipped so two sweeps
 * never race the same rows. Returns the posts that became due this sweep.
 */
export async function runSweep(): Promise<ScheduledPost[]> {
  if (isSweeping) {
    return [];
  }
  isSweeping = true;
  try {
    const now = Date.now();
    const db = await getDb();

    // SELECT the due ids first so we know exactly which rows to emit. We map
    // columns by hand rather than casting SELECT * rows.
    const dueRows = await db.select<ScheduledPostRow[]>(
      "SELECT id, workspace_id, draft_id, scheduled_for, status, created_at FROM scheduled_posts WHERE status = $1 AND scheduled_for <= $2 ORDER BY scheduled_for ASC",
      ["scheduled", now]
    );

    if (dueRows.length === 0) {
      return [];
    }

    // Flip them to `due` in one statement. After this, the next sweep can no
    // longer select them, so each post is emitted exactly once.
    await db.execute(
      "UPDATE scheduled_posts SET status = $1 WHERE status = $2 AND scheduled_for <= $3",
      ["due", "scheduled", now]
    );

    const posts = dueRows.map((row) => mapRow({ ...row, status: "due" }));
    logger.info({ count: posts.length }, "[Scheduler] Posts became due");
    emitDue(posts);
    return posts;
  } catch (err) {
    logger.error({ err }, "[Scheduler] Sweep failed");
    return [];
  } finally {
    isSweeping = false;
  }
}

/**
 * All posts currently in the `due` state. The publish pipeline (U10) reads this
 * on startup to pick up posts that became due before it subscribed, so nothing
 * is missed by a late subscriber.
 */
export async function getDuePosts(): Promise<ScheduledPost[]> {
  const db = await getDb();
  const rows = await db.select<ScheduledPostRow[]>(
    "SELECT id, workspace_id, draft_id, scheduled_for, status, created_at FROM scheduled_posts WHERE status = $1 ORDER BY scheduled_for ASC",
    ["due"]
  );
  return rows.map(mapRow);
}

/**
 * Subscribe to due-post batches. Returns an unsubscribe function. The publish
 * pipeline (U10) wires its consumer here.
 */
export function onDue(listener: DueListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Alias for {@link onDue}, for callers that prefer `subscribe()` naming. */
export const subscribe = onDue;

/** Whether the scheduler interval is currently running. */
export function isSchedulerRunning(): boolean {
  return intervalId !== null;
}

/**
 * Start the scheduler. Runs an immediate catch-up sweep so posts whose time
 * elapsed while the app was closed are picked up at launch, then polls on an
 * interval. Idempotent: a second call while already running is a no-op, which
 * makes it safe under React StrictMode's double-invoked effects.
 */
export function startScheduler(): () => void {
  if (intervalId !== null) {
    return stopScheduler;
  }

  logger.info(
    { intervalMs: SCHEDULER_POLL_INTERVAL_MS },
    "[Scheduler] Starting local scheduler"
  );

  // Catch-up sweep on launch. Fire-and-forget; `runSweep` never rejects (it
  // handles its own errors), but the extra `.catch` keeps the promise from
  // floating.
  runSweep().catch(() => {
    // unreachable: runSweep swallows its own errors
  });

  intervalId = setInterval(() => {
    runSweep().catch(() => {
      // unreachable: runSweep swallows its own errors
    });
  }, SCHEDULER_POLL_INTERVAL_MS);

  return stopScheduler;
}

/** Stop the scheduler interval. Idempotent. Does not clear subscribers. */
export function stopScheduler(): void {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info("[Scheduler] Stopped local scheduler");
  }
}
