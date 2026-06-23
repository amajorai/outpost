/**
 * Repository for the `brand_kit` table (U13).
 *
 * A brand kit is a per-workspace singleton: at most one row per workspace,
 * keyed by a UNIQUE `workspace_id`. Its list/object fields (logos, colors,
 * fonts, watermark) are JSON-encoded TEXT columns so the shape can evolve
 * without a SQLite migration. Reads parse defensively — a missing or malformed
 * blob degrades to the empty default rather than throwing — so an older or
 * partially-written row never breaks the editor.
 *
 * Columns are snake_case in SQLite; the domain `BrandKit` shape is camelCase. We
 * map explicitly, mirroring `lib/repos/social-accounts.ts`.
 */

import { getDb } from "@/lib/db";
import {
  type BrandColor,
  type BrandFont,
  type BrandKit,
  type BrandLogo,
  type BrandWatermark,
  DEFAULT_WORKSPACE_ID,
  type WatermarkPosition,
} from "@/lib/social-schema";

/** Row shape as returned by the snake_case `brand_kit` table. */
interface BrandKitRow {
  id: string;
  workspace_id: string;
  logos: string;
  colors: string;
  fonts: string;
  watermark: string | null;
  created_at: number;
  updated_at: number;
}

/** The columns we select, in order, so we never cast a `SELECT *` row. */
const SELECT_COLUMNS =
  "id, workspace_id, logos, colors, fonts, watermark, created_at, updated_at";

const WATERMARK_POSITIONS: readonly WatermarkPosition[] = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
  "center",
];

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Parse a JSON array column defensively, mapping each item through `map`. */
function parseArray<T>(
  raw: string,
  map: (item: Record<string, unknown>) => T
): T[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed
    .filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null
    )
    .map(map);
}

function parseLogos(raw: string): BrandLogo[] {
  return parseArray(raw, (item) => ({
    path: asString(item.path),
    name: asString(item.name),
  })).filter((logo) => logo.path.length > 0);
}

function parseColors(raw: string): BrandColor[] {
  return parseArray(raw, (item) => ({
    name: asString(item.name),
    value: asString(item.value),
  })).filter((color) => color.value.length > 0);
}

function parseFonts(raw: string): BrandFont[] {
  return parseArray(raw, (item) => ({
    name: asString(item.name),
    family: asString(item.family),
  })).filter((font) => font.family.length > 0);
}

function parseWatermark(raw: string | null): BrandWatermark | null {
  if (!raw) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const path = asString(record.path);
  if (path.length === 0) {
    return null;
  }
  const position = WATERMARK_POSITIONS.includes(
    record.position as WatermarkPosition
  )
    ? (record.position as WatermarkPosition)
    : "bottom-right";
  const opacity = Math.min(1, Math.max(0, asNumber(record.opacity, 1)));
  return { path, position, opacity };
}

/** Map a snake_case DB row to the camelCase domain shape. */
function mapRow(row: BrandKitRow): BrandKit {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    logos: parseLogos(row.logos),
    colors: parseColors(row.colors),
    fonts: parseFonts(row.fonts),
    watermark: parseWatermark(row.watermark),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** An empty, never-saved brand kit for a workspace that has no row yet. */
export function emptyBrandKit(
  workspaceId: string = DEFAULT_WORKSPACE_ID
): BrandKit {
  const now = Date.now();
  return {
    id: "",
    workspaceId,
    logos: [],
    colors: [],
    fonts: [],
    watermark: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Load the workspace's brand kit, or an empty default when none has been saved.
 * Never returns null so callers can render the editor unconditionally.
 */
export async function getBrandKit(
  workspaceId: string = DEFAULT_WORKSPACE_ID
): Promise<BrandKit> {
  const db = await getDb();
  const rows = await db.select<BrandKitRow[]>(
    `SELECT ${SELECT_COLUMNS} FROM brand_kit WHERE workspace_id = $1 LIMIT 1`,
    [workspaceId]
  );
  const row = rows[0];
  return row ? mapRow(row) : emptyBrandKit(workspaceId);
}

/** The editable parts of a brand kit a caller can persist. */
export interface SaveBrandKitInput {
  logos: BrandLogo[];
  colors: BrandColor[];
  fonts: BrandFont[];
  watermark: BrandWatermark | null;
  workspaceId?: string;
}

/**
 * Upsert the workspace's brand kit. Inserts the singleton row on first save and
 * updates it in place afterwards (preserving `created_at`). Returns the
 * persisted domain row.
 */
export async function saveBrandKit(
  input: SaveBrandKitInput
): Promise<BrandKit> {
  const db = await getDb();
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const now = Date.now();
  const logos = JSON.stringify(input.logos);
  const colors = JSON.stringify(input.colors);
  const fonts = JSON.stringify(input.fonts);
  const watermark = input.watermark ? JSON.stringify(input.watermark) : null;

  const existing = await db.select<BrandKitRow[]>(
    `SELECT ${SELECT_COLUMNS} FROM brand_kit WHERE workspace_id = $1 LIMIT 1`,
    [workspaceId]
  );

  if (existing.length > 0) {
    const row = existing[0];
    await db.execute(
      "UPDATE brand_kit SET logos = $1, colors = $2, fonts = $3, watermark = $4, updated_at = $5 WHERE id = $6",
      [logos, colors, fonts, watermark, now, row.id]
    );
    return {
      id: row.id,
      workspaceId,
      logos: input.logos,
      colors: input.colors,
      fonts: input.fonts,
      watermark: input.watermark,
      createdAt: row.created_at,
      updatedAt: now,
    };
  }

  const id = crypto.randomUUID();
  await db.execute(
    "INSERT INTO brand_kit (id, workspace_id, logos, colors, fonts, watermark, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    [id, workspaceId, logos, colors, fonts, watermark, now, now]
  );
  return {
    id,
    workspaceId,
    logos: input.logos,
    colors: input.colors,
    fonts: input.fonts,
    watermark: input.watermark,
    createdAt: now,
    updatedAt: now,
  };
}
