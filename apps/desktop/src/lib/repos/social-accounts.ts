/**
 * Repository for the `social_accounts` table (U5).
 *
 * Persists which platform accounts a workspace has connected. The provider
 * (Composio or the fake) owns OAuth tokens; this table never stores raw tokens
 * — only the account identity (platform, label, optional external id) and a
 * connected flag. Rows are workspace-scoped and multiple accounts per platform
 * are allowed.
 *
 * Columns are snake_case in SQLite; the domain `SocialAccount` shape is
 * camelCase. We map explicitly in both directions rather than casting a
 * `SELECT *` row, mirroring `lib/scheduler/scheduler.ts`.
 */

import { getCurrentWorkspaceId } from "@/lib/current-workspace";
import { getDb } from "@/lib/db";
import type { SocialAccount } from "@/lib/social-schema";

/** Row shape as returned by the snake_case `social_accounts` table. */
interface SocialAccountRow {
  id: string;
  workspace_id: string;
  platform: string;
  account_label: string;
  external_id: string | null;
  connected: number;
  created_at: number;
}

/** The columns we select, in order, so we never cast a `SELECT *` row. */
const SELECT_COLUMNS =
  "id, workspace_id, platform, account_label, external_id, connected, created_at";

/** Map a snake_case DB row to the camelCase domain shape. */
function mapRow(row: SocialAccountRow): SocialAccount {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    platform: row.platform,
    accountLabel: row.account_label,
    externalId: row.external_id,
    connected: row.connected,
    createdAt: row.created_at,
  };
}

/** Fields a caller supplies when persisting a freshly connected account. */
export interface CreateSocialAccountInput {
  /**
   * The account id. This is the same id passed to `provider.connect()` so the
   * provider's `ProviderAccount.id` and the persisted row stay in lockstep.
   */
  id: string;
  /** Platform key, e.g. "x", "linkedin". */
  platform: string;
  /** Human-friendly label shown in the UI, e.g. an @handle. */
  accountLabel: string;
  /** Remote account id when known; null for providers that don't surface one. */
  externalId?: string | null;
  /** Workspace to scope the account to. Defaults to the default workspace. */
  workspaceId?: string;
  /** Whether the account is currently connected. Defaults to true. */
  connected?: boolean;
}

/**
 * Persist a connected account. Callers connect through the provider first, then
 * call this on success, so a failed connect persists nothing.
 */
export async function createSocialAccount(
  input: CreateSocialAccountInput
): Promise<SocialAccount> {
  const db = await getDb();
  const workspaceId = input.workspaceId ?? getCurrentWorkspaceId();
  const externalId = input.externalId ?? null;
  const connected = (input.connected ?? true) ? 1 : 0;
  const createdAt = Date.now();

  await db.execute(
    "INSERT INTO social_accounts (id, workspace_id, platform, account_label, external_id, connected, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [
      input.id,
      workspaceId,
      input.platform,
      input.accountLabel,
      externalId,
      connected,
      createdAt,
    ]
  );

  return {
    id: input.id,
    workspaceId,
    platform: input.platform,
    accountLabel: input.accountLabel,
    externalId,
    connected,
    createdAt,
  };
}

/** List all accounts for a workspace, newest first. */
export async function listSocialAccounts(
  workspaceId: string = getCurrentWorkspaceId()
): Promise<SocialAccount[]> {
  const db = await getDb();
  const rows = await db.select<SocialAccountRow[]>(
    `SELECT ${SELECT_COLUMNS} FROM social_accounts WHERE workspace_id = $1 ORDER BY created_at DESC`,
    [workspaceId]
  );
  return rows.map(mapRow);
}

/** Remove an account by id. Returns true when a row was deleted. */
export async function removeSocialAccount(id: string): Promise<boolean> {
  const db = await getDb();
  const result = await db.execute("DELETE FROM social_accounts WHERE id = $1", [
    id,
  ]);
  return result.rowsAffected > 0;
}
