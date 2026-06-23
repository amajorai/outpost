/**
 * Repository for the `radar_targets` + `trend_signals` tables (U28).
 *
 * The competitor/trend radar has two persisted surfaces: the user's tracked
 * targets (creators + topics — the *input*) and the cached findings the radar
 * fetch step produces (creator winners + rising trends — the *output*).
 *
 * `radar_targets` is a single kind-discriminated table (`competitor` | `topic`)
 * so the two surfaces stay symmetric. `trend_signals` caches findings and is
 * upserted on refresh (keyed on the v17 UNIQUE dedupe index) so a re-fetch
 * updates a finding in place rather than duplicating it — mirroring
 * `activity_items`.
 *
 * SQLite treats NULLs as distinct in a UNIQUE index, so the dedupe-participating
 * `platform` / `target_id` columns are normalized to an empty string here (never
 * NULL) so an upsert actually matches. The mapped domain shape converts the
 * empty-string sentinel back to null so callers never see it.
 *
 * Columns are snake_case in SQLite; the domain shapes are camelCase — mapped
 * explicitly here, mirroring the sibling repos.
 */

import { getCurrentWorkspaceId } from "@/lib/current-workspace";
import { getDb } from "@/lib/db";
import type {
  RadarTarget,
  RadarTargetKind,
  TrendSignal,
  TrendSignalKind,
} from "@/lib/social-schema";

/** Row shape as returned by the snake_case `radar_targets` table. */
interface RadarTargetRow {
  id: string;
  workspace_id: string;
  kind: string;
  platform: string | null;
  value: string;
  label: string | null;
  added_at: number;
}

/** Row shape as returned by the snake_case `trend_signals` table. */
interface TrendSignalRow {
  id: string;
  workspace_id: string;
  kind: string;
  target_id: string | null;
  platform: string | null;
  external_id: string;
  title: string;
  summary: string | null;
  url: string | null;
  score: number;
  raw: string | null;
  fetched_at: number;
}

const TARGET_COLUMNS =
  "id, workspace_id, kind, platform, value, label, added_at";
const SIGNAL_COLUMNS =
  "id, workspace_id, kind, target_id, platform, external_id, title, summary, url, score, raw, fetched_at";

/** The empty-string sentinel a NULL dedupe column is stored as (see file doc). */
const NULL_SENTINEL = "";

/** Convert the empty-string sentinel back to null for the domain shape. */
function unsentinel(value: string | null): string | null {
  return value === NULL_SENTINEL ? null : value;
}

function mapTargetRow(row: RadarTargetRow): RadarTarget {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    kind: row.kind as RadarTargetKind,
    platform: unsentinel(row.platform),
    value: row.value,
    label: row.label,
    addedAt: row.added_at,
  };
}

function mapSignalRow(row: TrendSignalRow): TrendSignal {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    kind: row.kind as TrendSignalKind,
    targetId: unsentinel(row.target_id),
    platform: unsentinel(row.platform),
    externalId: row.external_id,
    title: row.title,
    summary: row.summary,
    url: row.url,
    score: row.score,
    raw: row.raw,
    fetchedAt: row.fetched_at,
  };
}

/** Fields a caller supplies when adding a tracked target. */
export interface AddRadarTargetInput {
  kind: RadarTargetKind;
  /** The @handle (competitor) or keyword/phrase (topic). */
  value: string;
  /** Platform key for a competitor; optional/null for a topic. */
  platform?: string | null;
  label?: string | null;
  workspaceId?: string;
}

/**
 * Add a tracked target, or return the existing one when the same
 * (workspace, kind, platform, value) is already tracked — the v17 UNIQUE index
 * makes re-adding idempotent. `value` is trimmed; a leading "@" is kept as the
 * user typed it (the fetch step strips it).
 */
export async function addRadarTarget(
  input: AddRadarTargetInput
): Promise<RadarTarget> {
  const db = await getDb();
  const workspaceId = input.workspaceId ?? getCurrentWorkspaceId();
  const platform = input.platform ?? NULL_SENTINEL;
  const value = input.value.trim();
  const label = input.label ?? null;
  const id = crypto.randomUUID();
  const addedAt = Date.now();
  await db.execute(
    `INSERT INTO radar_targets (id, workspace_id, kind, platform, value, label, added_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT(workspace_id, kind, platform, value) DO UPDATE SET
       label = COALESCE(excluded.label, radar_targets.label)`,
    [id, workspaceId, input.kind, platform, value, label, addedAt]
  );
  const rows = await db.select<RadarTargetRow[]>(
    `SELECT ${TARGET_COLUMNS} FROM radar_targets WHERE workspace_id = $1 AND kind = $2 AND platform = $3 AND value = $4 LIMIT 1`,
    [workspaceId, input.kind, platform, value]
  );
  const row = rows[0];
  if (!row) {
    throw new Error("Failed to persist radar target");
  }
  return mapTargetRow(row);
}

/** Remove a tracked target by id. Cascades nothing — its cached signals remain. */
export async function removeRadarTarget(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM radar_targets WHERE id = $1", [id]);
}

/** List a workspace's tracked targets, newest first. */
export async function listRadarTargets(
  workspaceId: string = getCurrentWorkspaceId()
): Promise<RadarTarget[]> {
  const db = await getDb();
  const rows = await db.select<RadarTargetRow[]>(
    `SELECT ${TARGET_COLUMNS} FROM radar_targets WHERE workspace_id = $1 ORDER BY added_at DESC`,
    [workspaceId]
  );
  return rows.map(mapTargetRow);
}

/** Fields a caller supplies when caching a fetched signal. */
export interface UpsertTrendSignalInput {
  kind: TrendSignalKind;
  /** The radar target this signal came from, or null for a general trend. */
  targetId?: string | null;
  platform?: string | null;
  /** Stable per-signal key (remote post id, or a slug of the title). */
  externalId: string;
  title: string;
  summary?: string | null;
  url?: string | null;
  score?: number;
  raw?: string | null;
  fetchedAt?: number;
  workspaceId?: string;
}

/**
 * Insert a fetched signal, or update it when the same finding is re-fetched
 * (same workspace + kind + platform + target + external id). A refresh updates
 * the score/title/summary in place rather than duplicating the row.
 */
export async function upsertTrendSignal(
  input: UpsertTrendSignalInput
): Promise<void> {
  const db = await getDb();
  const workspaceId = input.workspaceId ?? getCurrentWorkspaceId();
  const platform = input.platform ?? NULL_SENTINEL;
  const targetId = input.targetId ?? NULL_SENTINEL;
  await db.execute(
    `INSERT INTO trend_signals (id, workspace_id, kind, target_id, platform, external_id, title, summary, url, score, raw, fetched_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT(workspace_id, kind, platform, target_id, external_id) DO UPDATE SET
       title = excluded.title,
       summary = excluded.summary,
       url = COALESCE(excluded.url, trend_signals.url),
       score = excluded.score,
       raw = excluded.raw,
       fetched_at = excluded.fetched_at`,
    [
      crypto.randomUUID(),
      workspaceId,
      input.kind,
      targetId,
      platform,
      input.externalId,
      input.title,
      input.summary ?? null,
      input.url ?? null,
      input.score ?? 0,
      input.raw ?? null,
      input.fetchedAt ?? Date.now(),
    ]
  );
}

/** List a workspace's cached signals, highest score first then newest. */
export async function listTrendSignals(
  workspaceId: string = getCurrentWorkspaceId()
): Promise<TrendSignal[]> {
  const db = await getDb();
  const rows = await db.select<TrendSignalRow[]>(
    `SELECT ${SIGNAL_COLUMNS} FROM trend_signals WHERE workspace_id = $1 ORDER BY score DESC, fetched_at DESC`,
    [workspaceId]
  );
  return rows.map(mapSignalRow);
}

/** Delete every cached signal for a target (used before a fresh per-target fetch). */
export async function deleteSignalsForTarget(targetId: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM trend_signals WHERE target_id = $1", [
    targetId,
  ]);
}
