/**
 * Repository for the `drafts` table (U8).
 *
 * A draft is a composed-but-unscheduled post. The `body` column is a JSON blob
 * so the composer can evolve its shape without a schema migration: it holds the
 * post text, raw media references, and which accounts were selected. The
 * `DraftBody` interface below is the source of truth for that JSON shape and
 * carries its own `schemaVersion` per the Data Versioning Contract (CLAUDE.md).
 *
 * Columns are snake_case in SQLite; the domain `Draft` shape is camelCase. We map
 * explicitly in both directions rather than casting a `SELECT *` row, mirroring
 * `lib/repos/social-accounts.ts`.
 */

import type { MediaAttachment } from "@/lib/compose/platform-limits";
import { getDb } from "@/lib/db";
import { DEFAULT_WORKSPACE_ID, type Draft } from "@/lib/social-schema";

/** Current version of the JSON {@link DraftBody} shape. */
export const DRAFT_BODY_SCHEMA_VERSION = 1;

/**
 * The decoded shape of a draft's `body` JSON. Versioned so a body written by a
 * newer app can be migrated forward on read by older/newer builds.
 */
export interface DraftBody {
  schemaVersion: number;
  /** The post text. */
  text: string;
  /** Raw media attachments, by local path. */
  media: MediaAttachment[];
  /** Social account ids selected as publish targets. */
  accountIds: string[];
}

/** Build an empty, current-version draft body. */
export function emptyDraftBody(): DraftBody {
  return {
    schemaVersion: DRAFT_BODY_SCHEMA_VERSION,
    text: "",
    media: [],
    accountIds: [],
  };
}

/**
 * Decode a stored `body` string into a {@link DraftBody}, tolerating missing or
 * malformed fields. Treats absent fields as the empty default so a body written
 * by an earlier shape never throws. Future schema bumps add their migration here.
 */
export function decodeDraftBody(body: string): DraftBody {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return emptyDraftBody();
  }
  if (typeof parsed !== "object" || parsed === null) {
    return emptyDraftBody();
  }
  const record = parsed as Record<string, unknown>;
  const text = typeof record.text === "string" ? record.text : "";
  const media = Array.isArray(record.media)
    ? (record.media as MediaAttachment[])
    : [];
  const accountIds = Array.isArray(record.accountIds)
    ? (record.accountIds as string[])
    : [];
  return {
    schemaVersion: DRAFT_BODY_SCHEMA_VERSION,
    text,
    media,
    accountIds,
  };
}

/** Encode a {@link DraftBody} for storage, always writing the current version. */
export function encodeDraftBody(body: DraftBody): string {
  return JSON.stringify({
    schemaVersion: DRAFT_BODY_SCHEMA_VERSION,
    text: body.text,
    media: body.media,
    accountIds: body.accountIds,
  } satisfies DraftBody);
}

/** Row shape as returned by the snake_case `drafts` table. */
interface DraftRow {
  id: string;
  workspace_id: string;
  body: string;
  created_at: number;
  updated_at: number;
}

/** The columns we select, in order, so we never cast a `SELECT *` row. */
const SELECT_COLUMNS = "id, workspace_id, body, created_at, updated_at";

/** Map a snake_case DB row to the camelCase domain shape. */
function mapRow(row: DraftRow): Draft {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Fields a caller supplies when saving a draft. */
export interface SaveDraftInput {
  /** Existing draft id to update, or omit to insert a new draft. */
  id?: string;
  /** The decoded body to persist. */
  body: DraftBody;
  /** Workspace to scope the draft to. Defaults to the default workspace. */
  workspaceId?: string;
}

/**
 * Insert or update a draft. When `id` is supplied and the row exists it's
 * updated in place (preserving `created_at`); otherwise a new row is inserted.
 * Returns the persisted domain row.
 */
export async function saveDraft(input: SaveDraftInput): Promise<Draft> {
  const db = await getDb();
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const body = encodeDraftBody(input.body);
  const now = Date.now();

  if (input.id) {
    const existing = await db.select<DraftRow[]>(
      `SELECT ${SELECT_COLUMNS} FROM drafts WHERE id = $1`,
      [input.id]
    );
    if (existing.length > 0) {
      await db.execute(
        "UPDATE drafts SET body = $1, updated_at = $2 WHERE id = $3",
        [body, now, input.id]
      );
      const row = existing[0];
      return mapRow({ ...row, body, updated_at: now });
    }
  }

  const id = input.id ?? crypto.randomUUID();
  await db.execute(
    "INSERT INTO drafts (id, workspace_id, body, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)",
    [id, workspaceId, body, now, now]
  );
  return {
    id,
    workspaceId,
    body,
    createdAt: now,
    updatedAt: now,
  };
}

/** Load a single draft by id, or null when it doesn't exist. */
export async function getDraft(id: string): Promise<Draft | null> {
  const db = await getDb();
  const rows = await db.select<DraftRow[]>(
    `SELECT ${SELECT_COLUMNS} FROM drafts WHERE id = $1`,
    [id]
  );
  const row = rows[0];
  return row ? mapRow(row) : null;
}

/** List all drafts for a workspace, most recently updated first. */
export async function listDrafts(
  workspaceId: string = DEFAULT_WORKSPACE_ID
): Promise<Draft[]> {
  const db = await getDb();
  const rows = await db.select<DraftRow[]>(
    `SELECT ${SELECT_COLUMNS} FROM drafts WHERE workspace_id = $1 ORDER BY updated_at DESC`,
    [workspaceId]
  );
  return rows.map(mapRow);
}

/** Delete a draft by id. Returns true when a row was removed. */
export async function deleteDraft(id: string): Promise<boolean> {
  const db = await getDb();
  const result = await db.execute("DELETE FROM drafts WHERE id = $1", [id]);
  return result.rowsAffected > 0;
}
