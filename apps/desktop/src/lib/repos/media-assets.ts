/**
 * Repository for the `media_assets` table (U13).
 *
 * The media library is a workspace-scoped set of reusable media. Each row is a
 * reference to a local file (its path) plus display metadata, never a copy of
 * the bytes, mirroring how the composer holds attachments. Saving an attachment
 * to the library lets it be picked into later posts.
 *
 * Columns are snake_case in SQLite; the domain `MediaAsset` shape is camelCase.
 * We map explicitly in both directions rather than casting a `SELECT *` row,
 * mirroring `lib/repos/social-accounts.ts`.
 */

import { getCurrentWorkspaceId } from "@/lib/current-workspace";
import { getDb } from "@/lib/db";
import type { MediaAsset, MediaAssetKind } from "@/lib/social-schema";

/** Row shape as returned by the snake_case `media_assets` table. */
interface MediaAssetRow {
  id: string;
  workspace_id: string;
  kind: string;
  path: string;
  name: string;
  mime_type: string | null;
  created_at: number;
}

/** The columns we select, in order, so we never cast a `SELECT *` row. */
const SELECT_COLUMNS =
  "id, workspace_id, kind, path, name, mime_type, created_at";

/** Narrow a stored kind string to the domain union, defaulting to image. */
function coerceKind(kind: string): MediaAssetKind {
  return kind === "video" ? "video" : "image";
}

/** Map a snake_case DB row to the camelCase domain shape. */
function mapRow(row: MediaAssetRow): MediaAsset {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    kind: coerceKind(row.kind),
    path: row.path,
    name: row.name,
    mimeType: row.mime_type,
    createdAt: row.created_at,
  };
}

/** Derive an asset kind from a MIME type, defaulting to image. */
export function kindForMimeType(
  mimeType: string | null | undefined
): MediaAssetKind {
  return mimeType?.startsWith("video/") ? "video" : "image";
}

/** Fields a caller supplies when saving a media asset to the library. */
export interface CreateMediaAssetInput {
  path: string;
  name: string;
  mimeType?: string | null;
  /** Workspace to scope the asset to. Defaults to the default workspace. */
  workspaceId?: string;
}

/**
 * Save a media reference to the library. If the same path already exists in the
 * workspace the existing row is returned unchanged, so re-saving is idempotent
 * and never creates duplicates.
 */
export async function createMediaAsset(
  input: CreateMediaAssetInput
): Promise<MediaAsset> {
  const db = await getDb();
  const workspaceId = input.workspaceId ?? getCurrentWorkspaceId();
  const mimeType = input.mimeType ?? null;

  const existing = await db.select<MediaAssetRow[]>(
    `SELECT ${SELECT_COLUMNS} FROM media_assets WHERE workspace_id = $1 AND path = $2 LIMIT 1`,
    [workspaceId, input.path]
  );
  if (existing.length > 0) {
    return mapRow(existing[0]);
  }

  const id = crypto.randomUUID();
  const kind = kindForMimeType(mimeType);
  const createdAt = Date.now();
  await db.execute(
    "INSERT INTO media_assets (id, workspace_id, kind, path, name, mime_type, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [id, workspaceId, kind, input.path, input.name, mimeType, createdAt]
  );

  return {
    id,
    workspaceId,
    kind,
    path: input.path,
    name: input.name,
    mimeType,
    createdAt,
  };
}

/** List all media assets for a workspace, newest first. */
export async function listMediaAssets(
  workspaceId: string = getCurrentWorkspaceId()
): Promise<MediaAsset[]> {
  const db = await getDb();
  const rows = await db.select<MediaAssetRow[]>(
    `SELECT ${SELECT_COLUMNS} FROM media_assets WHERE workspace_id = $1 ORDER BY created_at DESC`,
    [workspaceId]
  );
  return rows.map(mapRow);
}

/** Remove a media asset by id. Returns true when a row was deleted. */
export async function deleteMediaAsset(id: string): Promise<boolean> {
  const db = await getDb();
  const result = await db.execute("DELETE FROM media_assets WHERE id = $1", [
    id,
  ]);
  return result.rowsAffected > 0;
}
