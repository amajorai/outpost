/**
 * Repository for the `deals` table (U31).
 *
 * The creator's sponsorship pipeline: one row per brand deal, moved through a
 * fixed status lifecycle the money-hub kanban/table groups by. `deliverables` is
 * a JSON blob in SQLite (the brand_kit precedent) that this repo parses to a
 * typed `DealDeliverable[]` and serializes back on write, so callers never see
 * the raw string.
 *
 * Columns are snake_case in SQLite; the domain `Deal` shape is camelCase. We map
 * explicitly in both directions rather than casting a `SELECT *` row, mirroring
 * the sibling repos. Queries are scoped by `workspace_id`.
 */

import { getDb } from "@/lib/db";
import {
  DEFAULT_WORKSPACE_ID,
  type Deal,
  type DealDeliverable,
  type DealStatus,
} from "@/lib/social-schema";

/** Row shape as returned by the snake_case `deals` table. */
interface DealRow {
  id: string;
  workspace_id: string;
  brand: string;
  status: string;
  rate: number;
  currency: string;
  deliverables: string;
  due_date: number | null;
  notes: string | null;
  created_at: number;
}

const SELECT_COLUMNS =
  "id, workspace_id, brand, status, rate, currency, deliverables, due_date, notes, created_at";

/**
 * Parse the JSON `deliverables` blob into a typed list. A malformed or
 * non-array blob decodes to an empty list so a single bad row never throws when
 * loading the pipeline.
 */
function parseDeliverables(raw: string): DealDeliverable[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(
        (item): item is { description?: unknown; done?: unknown } =>
          typeof item === "object" && item !== null
      )
      .map((item) => ({
        description:
          typeof item.description === "string" ? item.description : "",
        done: item.done === true,
      }));
  } catch {
    return [];
  }
}

function mapRow(row: DealRow): Deal {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    brand: row.brand,
    status: row.status as DealStatus,
    rate: row.rate,
    currency: row.currency,
    deliverables: parseDeliverables(row.deliverables),
    dueDate: row.due_date,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

/** Fields a caller supplies when creating a deal. */
export interface CreateDealInput {
  brand: string;
  status?: DealStatus;
  rate?: number;
  currency?: string;
  deliverables?: DealDeliverable[];
  dueDate?: number | null;
  notes?: string | null;
  workspaceId?: string;
}

const DEFAULT_CURRENCY = "USD";
const DEFAULT_STATUS: DealStatus = "lead";

/** Create a deal. Defaults to a `lead` with no deliverables. */
export async function createDeal(input: CreateDealInput): Promise<Deal> {
  const db = await getDb();
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const id = crypto.randomUUID();
  const createdAt = Date.now();
  const status = input.status ?? DEFAULT_STATUS;
  const rate = input.rate ?? 0;
  const currency = input.currency ?? DEFAULT_CURRENCY;
  const deliverables = input.deliverables ?? [];
  const dueDate = input.dueDate ?? null;
  const notes = input.notes ?? null;
  await db.execute(
    `INSERT INTO deals (id, workspace_id, brand, status, rate, currency, deliverables, due_date, notes, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      id,
      workspaceId,
      input.brand,
      status,
      rate,
      currency,
      JSON.stringify(deliverables),
      dueDate,
      notes,
      createdAt,
    ]
  );
  return {
    id,
    workspaceId,
    brand: input.brand,
    status,
    rate,
    currency,
    deliverables,
    dueDate,
    notes,
    createdAt,
  };
}

/** List a workspace's deals, newest first. */
export async function listDeals(
  workspaceId: string = DEFAULT_WORKSPACE_ID
): Promise<Deal[]> {
  const db = await getDb();
  const rows = await db.select<DealRow[]>(
    `SELECT ${SELECT_COLUMNS} FROM deals WHERE workspace_id = $1 ORDER BY created_at DESC`,
    [workspaceId]
  );
  return rows.map(mapRow);
}

/** Fields a caller can change on an existing deal. */
export interface UpdateDealInput {
  brand?: string;
  status?: DealStatus;
  rate?: number;
  currency?: string;
  deliverables?: DealDeliverable[];
  dueDate?: number | null;
  notes?: string | null;
}

/**
 * Patch a deal in place. Only supplied fields change; omitted fields keep their
 * stored value (COALESCE on each column, with the JSON blob re-serialized when
 * provided). A no-op when the id doesn't exist.
 */
export async function updateDeal(
  id: string,
  patch: UpdateDealInput
): Promise<void> {
  const db = await getDb();
  const deliverables =
    patch.deliverables === undefined
      ? null
      : JSON.stringify(patch.deliverables);
  // `dueDate` / `notes` are nullable, so undefined means "leave as is" while an
  // explicit null clears them. We pass a sentinel column flag for those two so a
  // deliberate null is distinguishable from "not supplied".
  const dueDateProvided = patch.dueDate !== undefined ? 1 : 0;
  const notesProvided = patch.notes !== undefined ? 1 : 0;
  await db.execute(
    `UPDATE deals SET
       brand = COALESCE($2, brand),
       status = COALESCE($3, status),
       rate = COALESCE($4, rate),
       currency = COALESCE($5, currency),
       deliverables = COALESCE($6, deliverables),
       due_date = CASE WHEN $7 = 1 THEN $8 ELSE due_date END,
       notes = CASE WHEN $9 = 1 THEN $10 ELSE notes END
     WHERE id = $1`,
    [
      id,
      patch.brand ?? null,
      patch.status ?? null,
      patch.rate ?? null,
      patch.currency ?? null,
      deliverables,
      dueDateProvided,
      patch.dueDate ?? null,
      notesProvided,
      patch.notes ?? null,
    ]
  );
}

/** Move a deal to a new status (the kanban drag/select). */
export async function setDealStatus(
  id: string,
  status: DealStatus
): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE deals SET status = $1 WHERE id = $2", [status, id]);
}

/** Delete a deal by id. */
export async function deleteDeal(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM deals WHERE id = $1", [id]);
}
