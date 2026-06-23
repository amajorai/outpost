/**
 * Repository for the `autoresearch_strategy` + `autoresearch_iterations` tables
 * (U27).
 *
 * The autoresearch loop has two persisted surfaces: a single per-workspace
 * strategy row (the user-editable `program.md` analog steering the loop) and an
 * append-only iteration log (one row per propose -> run -> score -> keep/discard
 * cycle, recorded whether kept or discarded so the history stays inspectable).
 *
 * The loop core (`lib/autoresearch/loop.ts`) owns the pure orchestration over an
 * injectable deps bag; this repo is DB persistence only. Columns are snake_case
 * in SQLite; the domain shapes are camelCase — mapped explicitly here, mirroring
 * the sibling repos.
 */

import { getDb } from "@/lib/db";
import {
  type AutoresearchDecision,
  type AutoresearchIteration,
  type AutoresearchStrategy,
  DEFAULT_WORKSPACE_ID,
  type ExperimentGoalMetric,
} from "@/lib/social-schema";

/** Row shape as returned by the snake_case `autoresearch_strategy` table. */
interface AutoresearchStrategyRow {
  workspace_id: string;
  content: string;
  goal_metric: string;
  observation_window_hours: number;
  updated_at: number;
}

/** Row shape as returned by the snake_case `autoresearch_iterations` table. */
interface AutoresearchIterationRow {
  id: string;
  workspace_id: string;
  iteration_number: number;
  proposal: string;
  experiment_id: string | null;
  metric_value: number | null;
  decision: string;
  created_at: number;
}

const STRATEGY_COLUMNS =
  "workspace_id, content, goal_metric, observation_window_hours, updated_at";
const ITERATION_COLUMNS =
  "id, workspace_id, iteration_number, proposal, experiment_id, metric_value, decision, created_at";

/** The strategy used for a workspace that has never saved one. */
const DEFAULT_GOAL_METRIC: ExperimentGoalMetric = "engagement_rate";
const DEFAULT_WINDOW_HOURS = 24;

/**
 * The starter strategy document, shown to a workspace that has never authored
 * one. It mirrors karpathy/autoresearch's `program.md`: the headings name the
 * levers the loop reads (goals, voice, niche, guardrails) so editing the prose
 * meaningfully steers the AI proposal.
 */
export const DEFAULT_STRATEGY_CONTENT = `# Strategy

## Goal
What outcome am I optimizing for? (e.g. grow reach, drive sign-ups, build authority)

## Voice
How should posts sound? (tone, length, formatting habits)

## Niche
What topics and audience am I writing for?

## Guardrails
What must the loop never do? (e.g. no clickbait, no controversy, no engagement bait)
`;

function mapStrategyRow(row: AutoresearchStrategyRow): AutoresearchStrategy {
  return {
    workspaceId: row.workspace_id,
    content: row.content,
    goalMetric: row.goal_metric as ExperimentGoalMetric,
    observationWindowHours: row.observation_window_hours,
    updatedAt: row.updated_at,
  };
}

function mapIterationRow(row: AutoresearchIterationRow): AutoresearchIteration {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    iterationNumber: row.iteration_number,
    proposal: row.proposal,
    experimentId: row.experiment_id,
    metricValue: row.metric_value,
    decision: row.decision as AutoresearchDecision,
    createdAt: row.created_at,
  };
}

/**
 * Load the workspace's saved strategy, or a default (never-persisted) one so the
 * UI always has something to edit. The default is not written to the DB until
 * the user saves, so a fresh workspace shows the starter doc.
 */
export async function getStrategy(
  workspaceId: string = DEFAULT_WORKSPACE_ID
): Promise<AutoresearchStrategy> {
  const db = await getDb();
  const rows = await db.select<AutoresearchStrategyRow[]>(
    `SELECT ${STRATEGY_COLUMNS} FROM autoresearch_strategy WHERE workspace_id = $1 LIMIT 1`,
    [workspaceId]
  );
  const row = rows[0];
  if (row) {
    return mapStrategyRow(row);
  }
  return {
    workspaceId,
    content: DEFAULT_STRATEGY_CONTENT,
    goalMetric: DEFAULT_GOAL_METRIC,
    observationWindowHours: DEFAULT_WINDOW_HOURS,
    updatedAt: 0,
  };
}

/** Fields a caller supplies when saving a strategy. */
export interface SaveStrategyInput {
  content: string;
  goalMetric: ExperimentGoalMetric;
  observationWindowHours: number;
  workspaceId?: string;
}

/**
 * Upsert the workspace's strategy row (one row per workspace, keyed on
 * workspace_id). Returns the persisted strategy.
 */
export async function saveStrategy(
  input: SaveStrategyInput
): Promise<AutoresearchStrategy> {
  const db = await getDb();
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const updatedAt = Date.now();
  await db.execute(
    `INSERT INTO autoresearch_strategy (workspace_id, content, goal_metric, observation_window_hours, updated_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT(workspace_id) DO UPDATE SET
       content = excluded.content,
       goal_metric = excluded.goal_metric,
       observation_window_hours = excluded.observation_window_hours,
       updated_at = excluded.updated_at`,
    [
      workspaceId,
      input.content,
      input.goalMetric,
      input.observationWindowHours,
      updatedAt,
    ]
  );
  return {
    workspaceId,
    content: input.content,
    goalMetric: input.goalMetric,
    observationWindowHours: input.observationWindowHours,
    updatedAt,
  };
}

/** List a workspace's iterations, newest first. */
export async function listIterations(
  workspaceId: string = DEFAULT_WORKSPACE_ID
): Promise<AutoresearchIteration[]> {
  const db = await getDb();
  const rows = await db.select<AutoresearchIterationRow[]>(
    `SELECT ${ITERATION_COLUMNS} FROM autoresearch_iterations WHERE workspace_id = $1 ORDER BY iteration_number DESC`,
    [workspaceId]
  );
  return rows.map(mapIterationRow);
}

/** The highest iteration number recorded for a workspace, or 0 when none. */
export async function getMaxIterationNumber(
  workspaceId: string = DEFAULT_WORKSPACE_ID
): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ max_number: number | null }[]>(
    "SELECT MAX(iteration_number) AS max_number FROM autoresearch_iterations WHERE workspace_id = $1",
    [workspaceId]
  );
  return rows[0]?.max_number ?? 0;
}

/**
 * The current best kept metric for a workspace: the highest `metric_value` among
 * iterations the loop kept. Null when nothing has been kept yet (the first
 * iteration always keeps, establishing the baseline).
 */
export async function getBestKeptMetric(
  workspaceId: string = DEFAULT_WORKSPACE_ID
): Promise<number | null> {
  const db = await getDb();
  const rows = await db.select<{ best: number | null }[]>(
    "SELECT MAX(metric_value) AS best FROM autoresearch_iterations WHERE workspace_id = $1 AND decision = 'kept'",
    [workspaceId]
  );
  return rows[0]?.best ?? null;
}

/** Fields a caller supplies when recording a freshly-started iteration. */
export interface CreateIterationInput {
  iterationNumber: number;
  /** JSON-encoded proposal the agent produced. */
  proposal: string;
  /** The U25 experiment started to score this proposal. */
  experimentId: string;
  workspaceId?: string;
}

/**
 * Record a started-but-not-yet-scored iteration (decision `pending`). Returns
 * the persisted iteration so the caller can advance/score it later.
 */
export async function createIteration(
  input: CreateIterationInput
): Promise<AutoresearchIteration> {
  const db = await getDb();
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const id = crypto.randomUUID();
  const createdAt = Date.now();
  const decision: AutoresearchDecision = "pending";
  await db.execute(
    `INSERT INTO autoresearch_iterations (id, workspace_id, iteration_number, proposal, experiment_id, metric_value, decision, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      workspaceId,
      input.iterationNumber,
      input.proposal,
      input.experimentId,
      null,
      decision,
      createdAt,
    ]
  );
  return {
    id,
    workspaceId,
    iterationNumber: input.iterationNumber,
    proposal: input.proposal,
    experimentId: input.experimentId,
    metricValue: null,
    decision,
    createdAt,
  };
}

/** Persist the scored outcome of an iteration: its metric and keep/discard verdict. */
export async function scoreIteration(input: {
  iterationId: string;
  metricValue: number;
  decision: AutoresearchDecision;
}): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE autoresearch_iterations SET metric_value = $1, decision = $2 WHERE id = $3",
    [input.metricValue, input.decision, input.iterationId]
  );
}
