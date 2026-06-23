/**
 * Repository for the `experiments` + `experiment_variants` + `experiment_results`
 * tables (U25).
 *
 * An experiment fans out into one `experiment_variants` row per candidate post
 * and, once evaluated, one `experiment_results` row per variant (the parent +
 * variant rows are written in one transaction so a partial failure never orphans
 * variants without a parent). The engine (`lib/experiments/engine.ts`) owns the
 * pure orchestration + winner selection; this repo is DB persistence only.
 *
 * `experiment_variants` and `experiment_results` scope through `experiment_id`
 * only (no own `workspace_id`), mirroring the post_targets/post_history
 * precedent. is_winner is an INTEGER flag (SQLite has no bool).
 *
 * Columns are snake_case in SQLite; the domain shapes are camelCase. We map
 * explicitly rather than casting a `SELECT *` row, mirroring the sibling repos.
 */

import { getDb } from "@/lib/db";
import {
  DEFAULT_WORKSPACE_ID,
  type Experiment,
  type ExperimentGoalMetric,
  type ExperimentResult,
  type ExperimentStatus,
  type ExperimentVariant,
} from "@/lib/social-schema";

/** Row shape as returned by the snake_case `experiments` table. */
interface ExperimentRow {
  id: string;
  workspace_id: string;
  name: string;
  goal_metric: string;
  status: string;
  observation_window_hours: number;
  created_at: number;
}

/** Row shape as returned by the snake_case `experiment_variants` table. */
interface ExperimentVariantRow {
  id: string;
  experiment_id: string;
  label: string;
  draft_body: string;
  scheduled_post_id: string | null;
  target_platform: string;
  scheduled_for: number | null;
}

/** Row shape as returned by the snake_case `experiment_results` table. */
interface ExperimentResultRow {
  id: string;
  experiment_id: string;
  variant_id: string;
  metric_value: number;
  measured_at: number;
  is_winner: number;
}

const EXPERIMENT_COLUMNS =
  "id, workspace_id, name, goal_metric, status, observation_window_hours, created_at";
const VARIANT_COLUMNS =
  "id, experiment_id, label, draft_body, scheduled_post_id, target_platform, scheduled_for";
const RESULT_COLUMNS =
  "id, experiment_id, variant_id, metric_value, measured_at, is_winner";

function mapExperimentRow(row: ExperimentRow): Experiment {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    goalMetric: row.goal_metric as ExperimentGoalMetric,
    status: row.status as ExperimentStatus,
    observationWindowHours: row.observation_window_hours,
    createdAt: row.created_at,
  };
}

function mapVariantRow(row: ExperimentVariantRow): ExperimentVariant {
  return {
    id: row.id,
    experimentId: row.experiment_id,
    label: row.label,
    draftBody: row.draft_body,
    scheduledPostId: row.scheduled_post_id,
    targetPlatform: row.target_platform,
    scheduledFor: row.scheduled_for,
  };
}

function mapResultRow(row: ExperimentResultRow): ExperimentResult {
  return {
    id: row.id,
    experimentId: row.experiment_id,
    variantId: row.variant_id,
    metricValue: row.metric_value,
    measuredAt: row.measured_at,
    isWinner: row.is_winner,
  };
}

/** One variant a caller supplies when creating an experiment. */
export interface CreateExperimentVariantInput {
  label: string;
  /** JSON-encoded post body for this variant. */
  draftBody: string;
  /** Platform key this variant publishes to, e.g. "x", "bluesky". */
  targetPlatform: string;
  /** Unix epoch millis to publish at; omit/null for "publish now". */
  scheduledFor?: number | null;
}

/** Fields a caller supplies when creating an experiment. */
export interface CreateExperimentInput {
  name: string;
  goalMetric: ExperimentGoalMetric;
  /** Hours after publish before the engine measures + picks a winner. */
  observationWindowHours: number;
  /** One entry per candidate variant. Must be non-empty. */
  variants: CreateExperimentVariantInput[];
  /** Workspace to scope the experiment to. Defaults to the default workspace. */
  workspaceId?: string;
}

/** The persisted result of creating an experiment: the parent + variant rows. */
export interface CreatedExperiment {
  experiment: Experiment;
  variants: ExperimentVariant[];
}

/**
 * Create an experiment: write one `experiments` row + one `experiment_variants`
 * row per variant, atomically. The experiment starts `draft`; the engine flips
 * it to `running` on publish and `complete` on evaluation. Throws if there are
 * no variants.
 */
export async function createExperiment(
  input: CreateExperimentInput
): Promise<CreatedExperiment> {
  if (input.variants.length === 0) {
    throw new Error("Cannot create an experiment with no variants");
  }

  const db = await getDb();
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const createdAt = Date.now();
  const experimentId = crypto.randomUUID();
  const status: ExperimentStatus = "draft";

  const variants: ExperimentVariant[] = input.variants.map((variant) => ({
    id: crypto.randomUUID(),
    experimentId,
    label: variant.label,
    draftBody: variant.draftBody,
    scheduledPostId: null,
    targetPlatform: variant.targetPlatform,
    scheduledFor: variant.scheduledFor ?? null,
  }));

  await db.execute("BEGIN TRANSACTION");
  try {
    await db.execute(
      "INSERT INTO experiments (id, workspace_id, name, goal_metric, status, observation_window_hours, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [
        experimentId,
        workspaceId,
        input.name,
        input.goalMetric,
        status,
        input.observationWindowHours,
        createdAt,
      ]
    );
    for (const variant of variants) {
      await db.execute(
        "INSERT INTO experiment_variants (id, experiment_id, label, draft_body, scheduled_post_id, target_platform, scheduled_for) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [
          variant.id,
          variant.experimentId,
          variant.label,
          variant.draftBody,
          variant.scheduledPostId,
          variant.targetPlatform,
          variant.scheduledFor,
        ]
      );
    }
    await db.execute("COMMIT");
  } catch (err) {
    await db.execute("ROLLBACK");
    throw err;
  }

  return {
    experiment: {
      id: experimentId,
      workspaceId,
      name: input.name,
      goalMetric: input.goalMetric,
      status,
      observationWindowHours: input.observationWindowHours,
      createdAt,
    },
    variants,
  };
}

/** List experiments for a workspace, newest first. */
export async function listExperiments(
  workspaceId: string = DEFAULT_WORKSPACE_ID
): Promise<Experiment[]> {
  const db = await getDb();
  const rows = await db.select<ExperimentRow[]>(
    `SELECT ${EXPERIMENT_COLUMNS} FROM experiments WHERE workspace_id = $1 ORDER BY created_at DESC`,
    [workspaceId]
  );
  return rows.map(mapExperimentRow);
}

/** Load a single experiment by id, or null when it doesn't exist. */
export async function getExperiment(
  experimentId: string
): Promise<Experiment | null> {
  const db = await getDb();
  const rows = await db.select<ExperimentRow[]>(
    `SELECT ${EXPERIMENT_COLUMNS} FROM experiments WHERE id = $1 LIMIT 1`,
    [experimentId]
  );
  const row = rows[0];
  return row ? mapExperimentRow(row) : null;
}

/** List the variants of an experiment, in insertion order. */
export async function listExperimentVariants(
  experimentId: string
): Promise<ExperimentVariant[]> {
  const db = await getDb();
  const rows = await db.select<ExperimentVariantRow[]>(
    `SELECT ${VARIANT_COLUMNS} FROM experiment_variants WHERE experiment_id = $1 ORDER BY rowid ASC`,
    [experimentId]
  );
  return rows.map(mapVariantRow);
}

/** A past winning variant: its measured metric paired with its post body. */
export interface ExperimentWinner {
  /** The winning variant's goal-metric value at measurement time. */
  metricValue: number;
  /** The winning variant's JSON-encoded draft body. */
  draftBody: string;
  /** The goal metric the parent experiment optimized for. */
  goalMetric: ExperimentGoalMetric;
}

/**
 * List a workspace's past experiment winners, highest metric first. Joins each
 * winning `experiment_results` row to its `experiment_variants` body and its
 * parent experiment's goal metric, so the autoresearch loop can learn from what
 * already won. Scoped through the parent experiment's workspace.
 */
export async function listExperimentWinners(
  workspaceId: string = DEFAULT_WORKSPACE_ID,
  limit = 5
): Promise<ExperimentWinner[]> {
  const db = await getDb();
  const rows = await db.select<
    { metric_value: number; draft_body: string; goal_metric: string }[]
  >(
    `SELECT r.metric_value, v.draft_body, e.goal_metric
     FROM experiment_results r
     JOIN experiment_variants v ON v.id = r.variant_id
     JOIN experiments e ON e.id = r.experiment_id
     WHERE r.is_winner = 1 AND e.workspace_id = $1
     ORDER BY r.metric_value DESC
     LIMIT $2`,
    [workspaceId, limit]
  );
  return rows.map((row) => ({
    metricValue: row.metric_value,
    draftBody: row.draft_body,
    goalMetric: row.goal_metric as ExperimentGoalMetric,
  }));
}

/** List the recorded results of an experiment. */
export async function listExperimentResults(
  experimentId: string
): Promise<ExperimentResult[]> {
  const db = await getDb();
  const rows = await db.select<ExperimentResultRow[]>(
    `SELECT ${RESULT_COLUMNS} FROM experiment_results WHERE experiment_id = $1`,
    [experimentId]
  );
  return rows.map(mapResultRow);
}

/** Advance an experiment's lifecycle status. */
export async function updateExperimentStatus(
  experimentId: string,
  status: ExperimentStatus
): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE experiments SET status = $1 WHERE id = $2", [
    status,
    experimentId,
  ]);
}

/** Link a variant to the scheduled post the engine created for it. */
export async function setVariantScheduledPost(
  variantId: string,
  scheduledPostId: string
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE experiment_variants SET scheduled_post_id = $1 WHERE id = $2",
    [scheduledPostId, variantId]
  );
}

/** One variant's measured outcome, as the engine hands it to the repo. */
export interface RecordExperimentResultInput {
  variantId: string;
  metricValue: number;
  isWinner: boolean;
}

/**
 * Persist one result row per variant, atomically. Upserts on
 * (experiment_id, variant_id) so re-evaluating an experiment overwrites its
 * prior results in place rather than duplicating them.
 */
export async function recordExperimentResults(input: {
  experimentId: string;
  results: RecordExperimentResultInput[];
  measuredAt: number;
}): Promise<void> {
  const db = await getDb();
  await db.execute("BEGIN TRANSACTION");
  try {
    for (const result of input.results) {
      await db.execute(
        `INSERT INTO experiment_results (id, experiment_id, variant_id, metric_value, measured_at, is_winner)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT(experiment_id, variant_id) DO UPDATE SET
           metric_value = excluded.metric_value,
           measured_at = excluded.measured_at,
           is_winner = excluded.is_winner`,
        [
          crypto.randomUUID(),
          input.experimentId,
          result.variantId,
          result.metricValue,
          input.measuredAt,
          result.isWinner ? 1 : 0,
        ]
      );
    }
    await db.execute("COMMIT");
  } catch (err) {
    await db.execute("ROLLBACK");
    throw err;
  }
}
