/**
 * Repository for the `autopilot_actions` table (U30).
 *
 * The crew orchestrator's single persisted surface. It doubles as plan storage
 * AND the audit log the unit requires: one row per proposed post, grouped into a
 * weekly plan by `plan_id`. Each row records its lifecycle (`proposed` ->
 * `approved`/`queued`/`rejected`) and, once queued, links the real
 * `scheduled_posts` row it created, so the whole chain stays inspectable.
 *
 * The orchestrator core (`lib/autopilot/orchestrator.ts`) owns the pure
 * approval-gate logic over an injectable deps bag; this repo is DB persistence
 * only. Columns are snake_case in SQLite; the domain shapes are camelCase —
 * mapped explicitly here, mirroring the sibling repos.
 */

import { getDb } from "@/lib/db";
import {
  type AutopilotAction,
  type AutopilotActionStatus,
  DEFAULT_WORKSPACE_ID,
} from "@/lib/social-schema";

/** Row shape as returned by the snake_case `autopilot_actions` table. */
interface AutopilotActionRow {
  id: string;
  workspace_id: string;
  plan_id: string;
  body: string;
  hook: string;
  target_platform: string;
  scheduled_for: number | null;
  rationale: string;
  status: string;
  scheduled_post_id: string | null;
  created_at: number;
}

const ACTION_COLUMNS =
  "id, workspace_id, plan_id, body, hook, target_platform, scheduled_for, rationale, status, scheduled_post_id, created_at";

function mapActionRow(row: AutopilotActionRow): AutopilotAction {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    planId: row.plan_id,
    body: row.body,
    hook: row.hook,
    targetPlatform: row.target_platform,
    scheduledFor: row.scheduled_for,
    rationale: row.rationale,
    status: row.status as AutopilotActionStatus,
    scheduledPostId: row.scheduled_post_id,
    createdAt: row.created_at,
  };
}

/** One proposed post a caller supplies when persisting a freshly-built plan. */
export interface CreateAutopilotActionInput {
  /** JSON-encoded draft body for the proposed post. */
  body: string;
  hook: string;
  targetPlatform: string;
  /** Concrete time the orchestrator assigned, or null if unscheduled. */
  scheduledFor: number | null;
  rationale: string;
}

/**
 * Persist a whole plan: one `autopilot_actions` row per proposed post, all
 * sharing one generated `plan_id`, atomically. Every row starts `proposed` (no
 * real account has been touched). Returns the persisted actions. Throws on an
 * empty plan so a caller can't silently record nothing.
 */
export async function createPlan(
  actions: CreateAutopilotActionInput[],
  workspaceId: string = DEFAULT_WORKSPACE_ID
): Promise<AutopilotAction[]> {
  if (actions.length === 0) {
    throw new Error("Cannot record an autopilot plan with no actions");
  }

  const db = await getDb();
  const planId = crypto.randomUUID();
  const createdAt = Date.now();
  const status: AutopilotActionStatus = "proposed";

  const rows: AutopilotAction[] = actions.map((action) => ({
    id: crypto.randomUUID(),
    workspaceId,
    planId,
    body: action.body,
    hook: action.hook,
    targetPlatform: action.targetPlatform,
    scheduledFor: action.scheduledFor,
    rationale: action.rationale,
    status,
    scheduledPostId: null,
    createdAt,
  }));

  await db.execute("BEGIN TRANSACTION");
  try {
    for (const row of rows) {
      await db.execute(
        "INSERT INTO autopilot_actions (id, workspace_id, plan_id, body, hook, target_platform, scheduled_for, rationale, status, scheduled_post_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
        [
          row.id,
          row.workspaceId,
          row.planId,
          row.body,
          row.hook,
          row.targetPlatform,
          row.scheduledFor,
          row.rationale,
          row.status,
          row.scheduledPostId,
          row.createdAt,
        ]
      );
    }
    await db.execute("COMMIT");
  } catch (err) {
    await db.execute("ROLLBACK");
    throw err;
  }

  return rows;
}

/** List a workspace's autopilot actions, newest first. */
export async function listActions(
  workspaceId: string = DEFAULT_WORKSPACE_ID
): Promise<AutopilotAction[]> {
  const db = await getDb();
  const rows = await db.select<AutopilotActionRow[]>(
    `SELECT ${ACTION_COLUMNS} FROM autopilot_actions WHERE workspace_id = $1 ORDER BY created_at DESC, scheduled_for ASC`,
    [workspaceId]
  );
  return rows.map(mapActionRow);
}

/** Fetch a single action by id, or null when it does not exist. */
export async function getAction(id: string): Promise<AutopilotAction | null> {
  const db = await getDb();
  const rows = await db.select<AutopilotActionRow[]>(
    `SELECT ${ACTION_COLUMNS} FROM autopilot_actions WHERE id = $1 LIMIT 1`,
    [id]
  );
  const row = rows[0];
  return row ? mapActionRow(row) : null;
}

/**
 * Mark an action `queued` and link the `scheduled_posts` row it created. This is
 * the auditable record that the action actually touched a real account, so the
 * scheduled-post id is written in the same statement as the status flip.
 */
export async function markActionQueued(
  id: string,
  scheduledPostId: string
): Promise<void> {
  const db = await getDb();
  const status: AutopilotActionStatus = "queued";
  await db.execute(
    "UPDATE autopilot_actions SET status = $1, scheduled_post_id = $2 WHERE id = $3",
    [status, scheduledPostId, id]
  );
}

/**
 * Mark an action `approved`: the explicit per-action user approval the
 * `approve-each` gate requires before the action may be queued. Only advances a
 * still-`proposed` action so an already-queued/rejected row can't be reopened.
 */
export async function markActionApproved(id: string): Promise<void> {
  const db = await getDb();
  const status: AutopilotActionStatus = "approved";
  await db.execute(
    "UPDATE autopilot_actions SET status = $1 WHERE id = $2 AND status = 'proposed'",
    [status, id]
  );
}

/** Mark an action `rejected`. It stays in the log for auditability. */
export async function markActionRejected(id: string): Promise<void> {
  const db = await getDb();
  const status: AutopilotActionStatus = "rejected";
  await db.execute("UPDATE autopilot_actions SET status = $1 WHERE id = $2", [
    status,
    id,
  ]);
}
